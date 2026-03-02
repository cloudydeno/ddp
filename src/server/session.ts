import { EJSON } from "@cloudydeno/ejson";
import { SpanKind, propagation, ROOT_CONTEXT, trace, type TextMapGetter, type Attributes } from "@cloudydeno/opentelemetry/pkg/api";

import { RandomStream } from "lib/random.ts";
import type { ServerSentPacket } from "lib/types.ts";
import type { DdpInterface } from "./interface.ts";
import { PresentedCollection } from "./publishing.ts";
import type { PublicationHandler, PublishStream, TracedClientSentPacket } from "./types.ts";
import { DdpSessionSubscription } from "./subscription.ts";
import { LiveVariable } from "lib/live-variable.ts";

const methodtracer = trace.getTracer('ddp.method');
const subtracer = trace.getTracer('ddp.subscription');

// tell opentelemetry how to get baggage from packets
const BaggageGetter: TextMapGetter<Record<string, string>> = {
  get(h,k) { return h[k]; },
  keys(h) { return Object.keys(h); },
};

/**
 * A server-side handle to an inbound DDP socket's backend state.
 *
 * @TODO this class can probably use W3C streams better (e.g. outgoing backpressure)
 * This would depend on WebSocketStream to properly function though.
 */
export abstract class DdpSession {

  public collections: Map<string, PresentedCollection> = new Map;
  public getCollection(collection: string): PresentedCollection {
    let match = this.collections.get(collection);
    if (!match) {
      match = new PresentedCollection(this, collection);
      this.collections.set(collection, match);
    }
    return match;
  }

  constructor (
    private readonly ddpInterface: DdpInterface,
    protected readonly telemetryAttrs: Attributes,
    // public readonly clientAddress: string,
    public readonly httpHeaders: Record<string, string>,
  ) {
    this.closeCtlr.signal.addEventListener('abort', () => {
      for (const ctlr of this.namedSubs.values()) {
        ctlr.stopCtlr.abort(`Client disconnected`);
      }
      this.namedSubs.clear();
    });

    this.telemetryAttrs['rpc.ddp.session'] = this.id;
    // this.telemetryAttrs['rpc.ddp.version'] = this.version;
  }
  // telemetryAttrs: Attributes;
  public closePromise: Promise<void> | null = null;

  get clientAddress(): string {
    return String(this.telemetryAttrs['network.peer.address']) ?? 'unknown';
  }

  protected readonly closeCtlr: AbortController = new AbortController();
  public get closeSignal(): AbortSignal { return this.closeCtlr.signal; }

  readonly userIdLive: LiveVariable<string|null> = new LiveVariable(null);
  get userId(): string | null {
    return this.userIdLive.getSnapshot();
  }
  // TODO: this needs to rerun subs.
  // https://github.com/meteor/meteor/blob/8eb67c1795f41bc6947c895ec9d49f4fc1de9c24/packages/ddp-server/livedata_server.js#L662
  async setUserId(userId: string | null): Promise<void> {
    if (userId !== null && typeof userId !== "string") throw new Error(
      `setUserId must be called on string or null, not ${typeof userId}`);

    await this.rerunSubsAfterFunc(() => {
      this.userIdLive.setSnapshot(userId);
    });
  }

  _isSending: boolean = true;
  _dontStartNewUniversalSubs: boolean = false;
  _pendingReady: Array<string> = [];
  async rerunSubsAfterFunc(innerFunc: () => void): Promise<void> {

    // TODO: throw if not called from the currently blocking ddp invocation due to unblock()

    // Prevent newly-created universal subscriptions from being added to our
    // session. They will be found below when we call startUniversalSubs.
    //
    // (We don't have to worry about named subscriptions, because we only add
    // them when we process a 'sub' message. We are currently processing a
    // 'method' message, and the method did not unblock, because it is illegal
    // to call setUserId after unblock. Thus we cannot be concurrently adding a
    // new named subscription).
    this._dontStartNewUniversalSubs = true;

    // Prevent current subs from updating our collectionViews and call their
    // stop callbacks. This may yield.
    for (const sub of this.listAllSubs()) {
      sub.stopCtlr.abort('Deactivating subscription');
    }

    // All subs should now be deactivated. Stop sending messages to the client,
    // save the state of the published collections, and reset to an empty view.
    for (const collection of this.collections.values()) {
      collection.startRerun();
    }

    // Callback to, most likely, update the connection's userId
    innerFunc();

    // _setUserId is normally called from a Meteor method with
    // DDP._CurrentMethodInvocation set. But DDP._CurrentMethodInvocation is not
    // expected to be set inside a publish function, so we temporary unset it.
    // Inside a publish function DDP._CurrentPublicationInvocation is set.

    // TODO: set up an async resource for current ddp message to replica this blocking
    //   await DDP._CurrentMethodInvocation.withValue(undefined, async function () {
    {
      // Save the old named subs, and reset to having no subscriptions.
      const oldNamedSubs = this.namedSubs;
      this.namedSubs = new Map;
      this.universalSubs = new Set;

      await Promise.all([...oldNamedSubs].map(async ([subscriptionId, sub]) => {
        const newSub = sub._recreate();
        this.namedSubs.set(subscriptionId, newSub);
        // nb: if the handler throws or calls this.error(), it will in fact
        // immediately send its 'nosub'. This is OK, though.
        await newSub._start();
      }));

      // Allow newly-created universal subs to be started on our connection in
      // parallel with the ones we're spinning up here, and spin up universal
      // subs.
      this._dontStartNewUniversalSubs = false;
      await this.ddpInterface.startDefaultPubs(this);
    } // , { name: '_setUserId' });

    // Start sending messages again, beginning with the diff from the previous
    // state of the world to the current state. No yields are allowed during
    // this diff, so that other changes cannot interleave.
    this._isSending = true;
    for (const collection of this.collections.values()) {
      collection.flushRerun();
    }
    if (this._pendingReady.length) {
      this.send([{
        msg: 'ready',
        subs: this._pendingReady,
      }]);
      this._pendingReady = [];
    }
  }

  public readonly id: string = Math.random().toString(16).slice(2);
  [Symbol.dispose](): void {
    this.close();
  }
  close(): void {
    if (!this.closeCtlr.signal.aborted) {
      this.closeCtlr.abort();
    }
  }
  onClose(callback: () => void): void {
    this.closeCtlr.signal.addEventListener('abort', callback);
  }

  public universalSubs: Set<DdpSessionSubscription> = new Set;
  public namedSubs: Map<string, DdpSessionSubscription> = new Map;

  protected listAllSubs(): Array<DdpSessionSubscription> {
    return [
      ...this.universalSubs,
      ...this.namedSubs.values(),
    ];
  }

  async startDefaultSub(label: string, handler: PublicationHandler) {
    if (this._dontStartNewUniversalSubs) return;
    const subscription = new DdpSessionSubscription(this, {
      subId: '',
      pubName: label,
      startFunc(): Promise<void | PublishStream | PublishStream[]> {
        return Promise.resolve(handler(subscription, []));
      },
    });
    this.universalSubs.add(subscription);
    await subtracer.startActiveSpan(label, {
      kind: SpanKind.SERVER,
      attributes: {
        'rpc.system': 'ddp-publish',
        'rpc.method': label,
      },
    }, (span) => subscription._start().finally(() => span.end()));
  }

  async handleClientPacket(pkt: TracedClientSentPacket) {
    const ctx = propagation.extract(ROOT_CONTEXT, pkt.baggage ?? {}, BaggageGetter);
    // console.debug("S<-", Deno.inspect(pkt, { depth: 1 }));
    switch (pkt.msg) {
      case 'connect':
        if (pkt.version != '1') {
          console.error(`WARN: refused connection for ddp version ${pkt.version}`);
          // don't care about the client's supported versions, either will work or won't
          this.send([{
            msg: 'failed',
            version: '1',
          }]);
          break;
        }
        this.send([{
          msg: 'connected',
          session: this.id,
        }]);
        this.ddpInterface.registerSocket(this);
        break;

      case 'ping':
        this.send([{
          msg: 'pong',
          id: pkt.id,
        }]);
        break;
      case 'sub': {
        await subtracer.startActiveSpan(pkt.name, {
          kind: SpanKind.SERVER,
          attributes: {
            'rpc.system': 'ddp-subscribe',
            'rpc.method': pkt.name,
            'rpc.ddp.sub_id': pkt.id,
          },
        }, ctx, async (span) => {
          const subscription = new DdpSessionSubscription(this, {
            subId: pkt.id,
            pubName: pkt.name,
            startFunc: (): Promise<void | PublishStream[] | PublishStream> => this.ddpInterface
              .callSubscribe(subscription, pkt.name, pkt.params),
          });
          this.namedSubs.set(pkt.id, subscription);
          await subscription._start()
            .finally(() => span.end());
        });
      } break;
      case 'unsub': {
        const sub = this.namedSubs.get(pkt.id);
        sub?.stop();
      } break;
      case 'method':
        await methodtracer.startActiveSpan(pkt.method, {
          kind: SpanKind.SERVER,
          attributes: {
            'rpc.system': 'ddp',
            'rpc.method': pkt.method,
            'rpc.ddp.method_id': pkt.id,
          },
        }, ctx, (span) => this.ddpInterface
          .callMethod(this, pkt.method, pkt.params, pkt.randomSeed ? new RandomStream(pkt.randomSeed) : null)
          .then<ServerSentPacket[],ServerSentPacket[]>(x => ([{
            msg: 'result',
            id: pkt.id,
            result: x,
          }, {
            msg: 'updated',
            methods: [pkt.id],
          }]), err => (console.error('method error:', err), [{
            msg: 'updated',
            methods: [pkt.id],
          }, {
            msg: 'result',
            id: pkt.id,
            error: err.isClientSafe
              ? err
              : {
                error: err.message,
                message: err.message,
              },
          }]))
          .then(pkt => this.send(pkt))
          .catch(err => console.warn(`WARN: failed to send method response: ${err.message}`))
          .finally(() => span.end()));
        break;
      default:
        console.error({pkt});
        throw new Error(`TODO: client sent unexpected packet ${pkt.msg}`);
    }
  }

  abstract send(pkts: ServerSentPacket[]): Promise<void> | void;
}

// TODO: this class can probably use W3C streams better (e.g. outgoing backpressure)
// This would depend on WebSocketStream to properly function though.
// TODO: rename DdpWebSocketSession
export class DdpSocketSession extends DdpSession {

  constructor (
    private readonly socket: WebSocket,
    ddpInterface: DdpInterface,
    public readonly encapsulation: 'sockjs' | 'raw',
    remoteAddr: Deno.Addr,
    httpHeaders: Record<string, string>,
  ) {
    super(ddpInterface, remoteAddr.transport == 'tcp' ? {
      // https://opentelemetry.io/docs/specs/semconv/registry/attributes/network/
      'network.transport': 'tcp',
      'network.type': remoteAddr.hostname.includes(':') ? 'ipv6' : 'ipv4',
      'network.peer.address': remoteAddr.hostname,
      'network.peer.port': remoteAddr.port,
    } : {}, httpHeaders);

    /** Pass received packets thru an identity stream to provide sequential input processing. */
    const inboundPipe = new TransformStream<TracedClientSentPacket,TracedClientSentPacket>();
    /** Handle to add received messages to the input stream. Closed to represent the client going away. */
    const inboundWriter = inboundPipe.writable.getWriter();

    socket.addEventListener('open', () => {
      console.debug('DDP WebSocket open');
      if (this.encapsulation == 'sockjs') socket.send('o');
    });
    socket.addEventListener('message', async (e) => {
      const msgs = this.encapsulation == 'sockjs'
        ? JSON.parse(e.data) as string[]
        : [e.data as string];
      for (const msgText of msgs) {
        const msg = EJSON.parse(msgText) as TracedClientSentPacket;
        await inboundWriter.write(msg);
      }
    });

    socket.addEventListener('error', (evt: ErrorEventInit) => {
      const error = evt.error ?? new Error(evt.message || 'Unidentified WebSocket error.');
      this.closeCtlr.abort(error);
      console.debug("DDP WebSocket errored:", error.message);
      inboundWriter.abort(error);
    });
    socket.addEventListener('close', () => {
      this.closeCtlr.abort();
      console.debug("DDP WebSocket closed");
      // On error event, close event is called directly after
      if (!inboundWriter.closed) {
        inboundWriter.close();
      }
    });

    this.closePromise = (async () => {
      for await (const inboundMsg of inboundPipe.readable) {
        await this.handleClientPacket(inboundMsg);
      }
    })();
  }

  send(pkts: ServerSentPacket[]) {
    this.closeSignal.throwIfAborted();
    for (const pkt of pkts) {
      // console.debug('S->', pkt.msg);
      if (this.encapsulation == 'raw') {
        this.socket.send(EJSON.stringify(pkt));
      }
    }
    if (this.encapsulation == 'sockjs') {
      this.socket.send('a'+JSON.stringify(pkts.map(x => EJSON.stringify(x))));
    }
  }
}

export class DdpStreamSession extends DdpSession {
  private sendWriter: WritableStreamDefaultWriter<string>;
  constructor (
    ddpInterface: DdpInterface,
    readable: ReadableStream<string>,
    writable: WritableStream<string>,
  ) {
    super(ddpInterface, {}, {});

    this.closePromise = readable.pipeTo(new WritableStream({
      write: async (packet) => {
        const msg = EJSON.parse(packet) as TracedClientSentPacket;
        await this.handleClientPacket(msg);
      },
      abort: (reason) => {
        const error = new Error(reason.message || 'Unidentified WebSocket error.');
        this.closeCtlr.abort(error);
        console.log("WebSocket errored:", error.message);
      },
      close: () => {
        this.closeCtlr.abort();
      },
    }));

    this.sendWriter = writable.getWriter();
    this.closeSignal.addEventListener('abort',
      () => this.sendWriter.close());
  }

  async send(pkts: ServerSentPacket[]) {
    this.closeSignal.throwIfAborted();
    for (const pkt of pkts) {
      // console.debug('S->', Deno.inspect(pkt, { depth: 1 }));
      await this.sendWriter.write(EJSON.stringify(pkt));
    }
  }
}
