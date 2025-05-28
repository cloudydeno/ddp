import { EJSON, type EJSONableProperty } from "@cloudydeno/ejson";
import { ROOT_CONTEXT, SpanKind, type TextMapGetter, propagation, trace } from "@cloudydeno/opentelemetry/pkg/api";

import type { ClientConnection, ClientSentPacket, DocumentFields, MeteorError, OutboundSubscription, ServerSentPacket } from "../lib/types.ts";
import { RandomStream } from "../lib/random.ts";

import { PresentedCollection } from "./publishing.ts";

export type MethodHandler = (socket: DdpSocket, params: EJSONableProperty[], random: RandomStream | null) => EJSONableProperty | Promise<EJSONableProperty>;
export type PublicationHandler = (socket: DdpSocketSubscription, params: EJSONableProperty[]) => Promise<void> | void;

// We add an extra field on DDP requests for distributed tracing.
// This is compatible with the meteor package "danopia:opentelemetry".
type TracedClientSentPacket = ClientSentPacket & {
  baggage?: Record<string, string>;
};

const methodtracer = trace.getTracer('ddp.method');
const subtracer = trace.getTracer('ddp.subscription');

const serverId = crypto.randomUUID().split('-')[0];

export class DdpInterface {
  private readonly methods: Map<string, MethodHandler> = new Map;
  private readonly defaultPubs: Set<PublicationHandler> = new Set;
  private readonly publications: Map<string, PublicationHandler> = new Map;
  private readonly openSockets: Set<DdpSocket> = new Set;

  addMethod(name: string, handler: MethodHandler): void {
    this.methods.set(name, handler);
  }
  addPublication(name: string | null, handler: PublicationHandler): void {
    if (name == null) {
      this.defaultPubs.add(handler);
    } else {
      this.publications.set(name, handler);
    }
  }

  registerSocket(socket: DdpSocket): void {
    this.openSockets.add(socket);
    socket.closePromise
      .catch(err => {
        console.warn(`WebSocket walked away: ${err}`);
      })
      .finally(() => {
        this.openSockets.delete(socket);
      });
    // for (const defaultPub of this.defaultPubs) {
    //   await defaultPub()
    // }
  }

  async callMethod(socket: DdpSocket, name: string, params: EJSONableProperty[], random: RandomStream | null): Promise<EJSONableProperty> {
    const handler = this.methods.get(name);
    if (!handler) {
      throw new Error(`unimplemented method: "${name}"`);
    }
    return await handler(socket, params, random);
  }

  async callSubscribe(sub: DdpSocketSubscription, name: string, params: EJSONableProperty[]): Promise<void> {
    const handler = this.publications.get(name);
    if (!handler) {
      throw new Error(`unimplemented sub: "${name}"`);
    }
    return await handler(sub, params);
  }
}

// tell opentelemetry how to get baggage from packets
const BaggageGetter: TextMapGetter<Record<string, string>> = {
  get(h,k) { return h[k]; },
  keys(h) { return Object.keys(h); },
};

export class DdpSocketSubscription implements OutboundSubscription {
  constructor(
    public readonly connection: DdpSocket,
    private readonly subId: string,
  ) {}
  public readonly stopCtlr: AbortController = new AbortController();

  unblock(): void {
    throw new Error("Method not implemented.");
  }

  public stop(error?: MeteorError) {
    if (!this.connection.subscriptions.delete(this.subId)) return;
    for (const collection of this.connection.collections.values()) {
      collection.dropSub(this.subId);
    }
    this.connection.send([{
      msg: 'nosub',
      id: this.subId,
      error,
    }]);
    this.stopCtlr.abort(error ? 'Subscription error' : 'Stop requested');
  }
  public onStop(callback: () => void) {
    this.stopCtlr.signal.addEventListener('abort', callback);
  }
  get signal(): AbortSignal {
    return this.stopCtlr.signal;
  }

  get userId(): string | null {
    return null; // TODO
    // return this.connection.userId;
  }

  public added(collection: string, id: string, fields: DocumentFields): void {
    this.connection.getCollection(collection).added(this.subId, id, fields);
  }
  public changed(collection: string, id: string, fields: DocumentFields): void {
    this.connection.getCollection(collection).changed(this.subId, id, fields);
  }
  public removed(collection: string, id: string): void {
    this.connection.getCollection(collection).removed(this.subId, id);
  }

  public error(error: Error): void {
    this.stop({
      isClientSafe: true,
      error: 'server-error',
      reason: error.message,
      message: error.message+' [server-error]',
      details: 'TODO: more metadata for DDP errors',
      errorType: "Meteor.Error",
    });
  }

  public ready(): void {
    return this.connection.send([{
      msg: 'ready',
      subs: [this.subId],
    }]);
  }
}

// TODO: this class can probably use W3C streams better (e.g. outgoing backpressure)
// This would depend on WebSocketStream to properly function though.
export class DdpSocket implements ClientConnection {

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
    private readonly socket: WebSocket,
    private readonly ddpInterface: DdpInterface,
    public readonly encapsulation: 'sockjs' | 'raw',
  ) {
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

    this.closeCtlr.signal.addEventListener('abort', () => {
      for (const ctlr of this.subscriptions.values()) {
        ctlr.stopCtlr.abort(`Client disconnected`);
      }
      this.subscriptions.clear();
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
  public readonly closePromise: Promise<void>;

  private readonly closeCtlr = new AbortController();
  public get closeSignal(): AbortSignal { return this.closeCtlr.signal; }

  id = 'string';
  close(): void {
    this.closeCtlr.abort();
  }
  onClose(callback: () => void): void {
    this.closeCtlr.signal.addEventListener('abort', callback);
  }
  clientAddress = 'string';
  httpHeaders: Record<string, string> = {};

  public readonly subscriptions: Map<string, DdpSocketSubscription> = new Map;

  async handleClientPacket(pkt: TracedClientSentPacket) {
    const ctx = propagation.extract(ROOT_CONTEXT, pkt.baggage ?? {}, BaggageGetter);
    // console.log("<--", Deno.inspect(pkt, { depth: 1 }));
    switch (pkt.msg) {
      case 'connect':
        // "version\":\"1\"
        // "support\":[\"1\",\"pre2\",\"pre1\"]
        this.send([{
          msg: "connected",
          session: Math.random().toString(16).slice(2),
        }, {
          msg: "added",
          collection: '_dist-app-deno',
          id: 'ddp-server-identity',
          fields: {
            serverId,
            region: Deno.env.get('DENO_REGION'),
            deploymentId: Deno.env.get('DENO_DEPLOYMENT_ID'),
            denoVersion: Deno.version.deno,
          },
        }]);
        break;
      case 'ping':
        this.send([{
          msg: "pong",
        }]);
        break;
      case 'sub': {
        const subscription = new DdpSocketSubscription(this, pkt.id);
        this.subscriptions.set(pkt.id, subscription);
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
        const sub = this.subscriptions.get(pkt.id);
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
            msg: "result",
            id: pkt.id,
            result: x,
          }, {
            msg: "updated",
            methods: [pkt.id],
          }]), err => (console.error('method error:', err), [{
            msg: "result",
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

  send(pkts: ServerSentPacket[]) {
    this.closeSignal.throwIfAborted();
    for (const pkt of pkts) {
      // console.log('-->', pkt.msg);
      if (this.encapsulation == 'raw') {
        this.socket.send(EJSON.stringify(pkt));
      }
    }
    if (this.encapsulation == 'sockjs') {
      this.socket.send('a'+JSON.stringify(pkts.map(x => EJSON.stringify(x))));
    }
  }
}
