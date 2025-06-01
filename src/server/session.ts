import { EJSON } from "@cloudydeno/ejson";
import { SpanKind, propagation, ROOT_CONTEXT, trace, type TextMapGetter } from "@cloudydeno/opentelemetry/pkg/api";

import { RandomStream } from "lib/random.ts";
import type { ServerSentPacket } from "lib/types.ts";
import type { DdpInterface } from "./interface.ts";
import { PresentedCollection } from "./publishing.ts";
import type { PublicationHandler, TracedClientSentPacket } from "./types.ts";
import { DdpSocketSubscription } from "./subscription.ts";

const methodtracer = trace.getTracer('ddp.method');
const subtracer = trace.getTracer('ddp.subscription');

// tell opentelemetry how to get baggage from packets
const BaggageGetter: TextMapGetter<Record<string, string>> = {
  get(h,k) { return h[k]; },
  keys(h) { return Object.keys(h); },
};

// TODO: this class can probably use W3C streams better (e.g. outgoing backpressure)
// This would depend on WebSocketStream to properly function though.
export abstract class DdpSession {

  public readonly collections: Map<string, PresentedCollection> = new Map;
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
  ) {
    this.closeCtlr.signal.addEventListener('abort', () => {
      for (const ctlr of this.namedSubs.values()) {
        ctlr.stopCtlr.abort(`Client disconnected`);
      }
      this.namedSubs.clear();
    });

    // this.telemetryAttrs = {
      // 'rpc.ddp.session': this.id,
      // 'rpc.ddp.version': this.version,
    // 'meteor.user_id': this.userId,
      // 'net.peer.name': this.socket.remoteAddress,
      // 'net.peer.port': this.socket.remotePort,
      // 'net.host.name': this.socket.address.address,
      // 'net.host.port': this.socket.address.port,
      // 'net.sock.family': ({'IPv4':'inet','IPv6':'inet6'})[this.socket.address.family] ?? this.socket.address.family,
    // }
  }
  // telemetryAttrs: Attributes;
  public closePromise: Promise<void> | null = null;

  protected readonly closeCtlr: AbortController = new AbortController();
  public get closeSignal(): AbortSignal { return this.closeCtlr.signal; }

  public readonly id: string = Math.random().toString(16).slice(2);
  [Symbol.dispose](): void {
    this.closeCtlr.abort();
  }
  close(): void {
    this.closeCtlr.abort();
  }
  onClose(callback: () => void): void {
    this.closeCtlr.signal.addEventListener('abort', callback);
  }
  clientAddress = 'string';
  httpHeaders: Record<string, string> = {};

  public readonly universalSubs: Set<DdpSocketSubscription> = new Set;
  public readonly namedSubs: Map<string, DdpSocketSubscription> = new Map;

  async startDefaultSub(label: string, handler: PublicationHandler) {
    const subscription = new DdpSocketSubscription(this, '');
    this.universalSubs.add(subscription);
    await subtracer.startActiveSpan(label, {
      kind: SpanKind.SERVER,
      attributes: {
        'rpc.system': 'ddp-publish',
        'rpc.method': label,
      },
    }, (span) => Promise
      .resolve(handler(subscription, []))
      .catch(err => subscription.error(err))
      .finally(() => span.end()));
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
        const subscription = new DdpSocketSubscription(this, pkt.id);
        this.namedSubs.set(pkt.id, subscription);
        await subtracer.startActiveSpan(pkt.name, {
          kind: SpanKind.SERVER,
          attributes: {
            'rpc.system': 'ddp-subscribe',
            'rpc.method': pkt.name,
            'rpc.ddp.sub_id': pkt.id,
          },
        }, ctx, (span) => this.ddpInterface
          .callSubscribe(subscription, pkt.name, pkt.params)
          .catch(err => subscription.error(err))
          .finally(() => span.end()));
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
            msg: 'result',
            id: pkt.id,
            error: {
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
  ) {
    super(ddpInterface);

    socket.addEventListener('open', () => {
      // console.log('socket open')
      if (this.encapsulation == 'sockjs') socket.send('o');
    });
    socket.addEventListener('message', (e) => {
      const msgs = this.encapsulation == 'sockjs'
        ? JSON.parse(e.data) as string[]
        : [e.data as string];
      for (const msgText of msgs) {
        const msg = EJSON.parse(msgText) as TracedClientSentPacket;
        this.handleClientPacket(msg);
      }
    });

    this.closePromise = new Promise<void>((ok, fail) => {
      socket.addEventListener('error', (evt: ErrorEventInit) => {
        const error = evt.error ?? new Error(evt.message || 'Unidentified WebSocket error.');
        fail(new Error(`WebSocket errored: ${error.message}`));
        this.closeCtlr.abort(error);
        console.log("WebSocket errored:", error.message);
      });
      socket.addEventListener('close', () => {
        ok();
        this.closeCtlr.abort();
        console.log("WebSocket closed");
      });
    });

    // this.telemetryAttrs = {
      // 'rpc.ddp.session': this.id,
      // 'rpc.ddp.version': this.version,
    // 'meteor.user_id': this.userId,
      // 'net.peer.name': this.socket.remoteAddress,
      // 'net.peer.port': this.socket.remotePort,
      // 'net.host.name': this.socket.address.address,
      // 'net.host.port': this.socket.address.port,
      // 'net.sock.family': ({'IPv4':'inet','IPv6':'inet6'})[this.socket.address.family] ?? this.socket.address.family,
    // }
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
    super(ddpInterface);

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
        console.log("WebSocket closed");
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
