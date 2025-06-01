import { EJSON, type EJSONableProperty } from "@cloudydeno/ejson";
// import { EJSON, type EJSONableProperty } from "jsr:@cloudydeno/ejson@0.1.1";

import { trace, SpanKind, SpanStatusCode, Span, context, propagation, Context } from "@cloudydeno/opentelemetry/pkg/api";
// import { trace, SpanKind, SpanStatusCode, Span, context, propagation, Context } from "jsr:@cloudydeno/opentelemetry@0.10.1/pkg/api";

const clientTracer = trace.getTracer('ddp.client');
const methodTracer = trace.getTracer('ddp.method');
const subTracer = trace.getTracer('ddp.subscription');

import type { ClientSentPacket, ServerSentPacket } from "../lib/types.ts";
import { LiveCollection, CollectionApi } from "./collection.ts";
import type { Collection } from "./types.ts";
// import { DDPCollection, MongoCollection } from "./ddp-livedata";
// import { ClientSentPacket, ServerSentPacket, DocumentPacket } from "../types.ts";

export class DdpSubscription {
  constructor(
    private readonly client: DDPClient,
    public readonly subId: string,
    public readonly ready: Promise<void>,
  ) {}
  private isLive = true;

  stop() {
    if (!this.isLive) return;
    this.client.sendMessage({
      msg: 'unsub',
      id: this.subId,
    });
    this.isLive = false;
  }
}

export class DDPClient {
  constructor(
    _wss: unknown, // TODO: remove unless we want WebSocketStream
    private readonly readable: ReadableStream<string>,
    private readonly writable: WritableStream<string>,
    public readonly encapsulation: 'sockjs' | 'raw',
  ) {
    this.writer = this.writable.getWriter();
  }
  private readonly writer: WritableStreamDefaultWriter<string>;

  private readonly collections: Map<string, LiveCollection> = new Map;
  private readonly pendingMethods: Map<string, {
    // deno-lint-ignore no-explicit-any
    ok: (result: any) => void;
    fail: (error: Error) => void;
    span?: Span | null;
  }> = new Map;
  private readonly pendingPings: Map<string, {
    ok: () => void;
    fail: (error: Error) => void;
    span?: Span | null;
  }> = new Map;
  private readonly pendingSubs: Map<string, {
    ok: () => void;
    fail: (error: Error) => void;
    span: Span;
  }> = new Map;
  private readonly readySubs: Set<string> = new Set;

  private grabCollection(collectionName: string): LiveCollection {
    let coll = this.collections.get(collectionName);
    if (!coll) {
      coll = new LiveCollection();
      this.collections.set(collectionName, coll);
    }
    return coll;
  }
  public getCollection<T extends {_id: string}>(collectionName: string): Collection<T> {
    const coll = this.grabCollection(collectionName);
    return new CollectionApi<T>(coll);
  }

  async callMethod<T=EJSONableProperty>(name: string, params: EJSONableProperty[]): Promise<T> {
    const methodId = Math.random().toString(16).slice(2);
    const span = name == 'OTLP/v1/traces' ? null : methodTracer.startSpan(name, {
      kind: SpanKind.CLIENT,
      attributes: {
        'rpc.system': 'ddp',
        'rpc.method': name,
        // 'rpc.ddp.session': this.id,
        // 'rpc.ddp.version': this.version,
        'rpc.ddp.method_id': methodId,
        // 'ddp.user_id': this.userId ?? '',
        // 'ddp.connection': this.connection?.id,
      },
    });

    console.log('--> call', name);
    return await new Promise<T>((ok, fail) => {
      this.pendingMethods.set(methodId, {ok, fail, span});
      this.sendMessage({
        msg: 'method',
        id: methodId,
        method: name,
        params: params,
      }, span ? trace.setSpan(context.active(), span) : context.active()).catch(fail);
    });
  }

  async ping() {
    const pingId = Math.random().toString(16).slice(2);
    await new Promise<void>((ok, fail) => {
      this.pendingPings.set(pingId, {ok, fail});
      this.sendMessage({
        msg: 'ping',
        id: pingId,
      }).catch(fail);
    });
  }

  subscribe(name: string, params: EJSONableProperty[]): DdpSubscription {
    const subId = Math.random().toString(16).slice(2);
    const span = subTracer.startSpan(name, {
      kind: SpanKind.CLIENT,
      attributes: {
        'rpc.system': 'ddp-subscribe',
        'rpc.method': name,
        // 'rpc.ddp.session': this.id,
        // 'rpc.ddp.version': this.version,
        'rpc.ddp.sub_id': subId,
        // 'ddp.user_id': this.userId ?? '',
        // 'ddp.connection': this.connection?.id,
      },
    });

    console.log('--> sub', name, params);
    const readyPromise = new Promise<void>((ok, fail) => {
      this.pendingSubs.set(subId, {ok, fail, span});
      this.sendMessage({
        msg: 'sub',
        id: subId,
        name: name,
        params: params,
      }, trace.setSpan(context.active(), span)).catch(fail);
    });
    return new DdpSubscription(this, subId, readyPromise);
  }

  async runHandshake(): Promise<void> {
    const setupReader = this.readable.getReader() as ReadableStreamDefaultReader<string>;

    const handshakeSpan = clientTracer.startSpan('DDP handshake');
    try {
      await this.sendMessage({
        msg: "connect",
        version: "1",
        support: ["1"],
      });

      if (this.encapsulation == 'sockjs') {
        {
          const {value} = await setupReader.read();
          if (value !== 'o') throw new Error(`Unexpected banner: ${JSON.stringify(value)}`)
        }

        // TODO: the parsing should be handled by a transformstream, read from that instead
        const {value} = await setupReader.read();
        if (value?.[0] !== 'a') throw new Error(`Unexpected connect resp: ${JSON.stringify(value)}`)
        const packet = EJSON.parse(JSON.parse(value.slice(1))[0]) as ServerSentPacket;
        if (packet.msg !== 'connected') throw new Error(`Unexpected connect msg: ${JSON.stringify(packet)}`);
        // const session = packet.session as string;

      } else {
        const {value} = await setupReader.read();
        if (value?.[0] !== '{') throw new Error(`Unexpected connect resp: ${JSON.stringify(value)}`)
        const packet = EJSON.parse(value) as ServerSentPacket;
        if (packet.msg !== 'connected') throw new Error(`Unexpected connect msg: ${JSON.stringify(packet)}`);
      }
    } finally {
      handshakeSpan.end();
    }

    setupReader.releaseLock();
  }

  async runInboundLoop(): Promise<void> {
    if (this.encapsulation == 'raw') {
      for await (const chunk of this.readable) {
        const packet = EJSON.parse(chunk) as ServerSentPacket;
        try {
          await this.handlePacket(packet);
        } catch (thrown) {
          const err = thrown as Error;
          console.error('packet handle failed:', err);
        }
      }
      return;
    }

    for await (const chunk of this.readable) switch (chunk[0]) {
      case 'o': throw new Error(`got second open?`);
      case 'a': {
        for (const pkt of JSON.parse(chunk.slice(1))) {
          const packet = EJSON.parse(pkt) as ServerSentPacket;
          await this.handlePacket(packet);
        }
        break;
      }
      case 'c': {
        const [code, message] = JSON.parse(chunk.slice(1));
        throw new Error(`DDP connection closed by server: ${message} [${code}]`);
      }
      default: throw new Error(`got unimpl packet ${JSON.stringify(chunk)}`);
    }
  }

  async handlePacket(packet: ServerSentPacket): Promise<void> {
    // console.debug('C<-', Deno.inspect(packet, { depth: 1 }));
    switch (packet.msg) {
      case 'ping':
        await this.sendMessage({ msg: 'pong', id: packet.id });
        break;
      case 'pong':{
        if (!packet.id) {
          for (const ping of this.pendingPings.values()) {
            ping.ok();
          }
          this.pendingPings.clear();
          break;
        }
        const handlers = this.pendingPings.get(packet.id);
        if (!handlers) break; // warn?
        this.pendingPings.delete(packet.id);
        handlers.ok();
        handlers.span?.end();
      } break;
      case 'error':
        console.error('DDP error:', packet);
        throw new Error(`DDP error: ${packet.reason ?? '(no reason)'}`);
      case 'updated':
        // We don't do client-side simulations so this isn't important
        break;

      // Subscription results
      case 'ready':
        for (const subId of packet.subs) {
          const handlers = this.pendingSubs.get(subId);
          if (!handlers) throw new Error(
            `DDP error: received "${packet.msg}" for unknown subscription ${JSON.stringify(subId)}`);
          this.pendingSubs.delete(subId);
          this.readySubs.add(subId);

          handlers.ok();
          handlers.span.end();
        }
        break;
      case 'nosub': {
        // TODO: this happens after a sub is pending, right?
        const handlers = this.pendingSubs.get(packet.id);
        if (handlers) {
          this.pendingSubs.delete(packet.id);

          const message = packet.error?.message
            ?? 'Server refused the subscription without providing an error';
          handlers.fail(new Error(message));
          handlers.span.setStatus({ code: SpanStatusCode.ERROR, message });
          handlers.span.end();
        } else if (this.readySubs.delete(packet.id)) {
          // Any sort of cleanup for ready subs?
        } else throw new Error(
          `DDP error: received "${packet.msg}" for unknown subscription ${JSON.stringify(packet.id)}`);

      } break;

      // Method results
      case 'result': {
        const handlers = this.pendingMethods.get(packet.id);
        if (!handlers) throw new Error(
          `DDP error: received "${packet.msg}" for unknown method call ${JSON.stringify(packet.id)}`);
        this.pendingMethods.delete(packet.id);
        if (packet.error) {
          handlers.span?.setStatus({
            code: SpanStatusCode.ERROR,
            message: packet.error.message,
          });
          // TODO: throw a MeteorError-alike
          // TODO: there's more details than just this
          handlers.fail(new Error(packet.error.message));
        } else {
          handlers.ok(packet.result);
        }
        handlers.span?.end();
      } break;

      // Subscription document events
      case 'added':
        this.grabCollection(packet.collection)
          .addDocument(packet.id, packet.fields ?? {});
        break;
      case 'changed':
        this.grabCollection(packet.collection)
          .changeDocument(packet.id, packet.fields ?? {}, packet.cleared ?? []);
        break;
      case 'removed':
        this.grabCollection(packet.collection)
          .removeDocument(packet.id);
        break;

      // Apparently meteor never actually used ordered publications
      case 'addedBefore':
      case 'movedBefore':
        throw new Error(`TODO: DDP subscription ordering is not implemented`);

      default:
        console.log('<--', packet);
    }
  }

  async sendMessage(packet: ClientSentPacket, traceContext?: Context): Promise<void> {
    const baggage: Record<string,string> = {};
    if (traceContext) {
      propagation.inject(traceContext, baggage, {
        set: (h, k, v) => h[k] = typeof v === 'string' ? v : String(v),
      });
    }
    const fullPacket = { ...packet, baggage };

    // console.debug('C->', Deno.inspect(packet, { depth: 1 }));

    if (this.encapsulation == 'raw') {
      await this.writer.write(EJSON.stringify(fullPacket));
    } else {
      await this.writer.write(JSON.stringify([EJSON.stringify(fullPacket)]));
    }
  }

  static async connectToUrl(appUrl: string, encapsulation: 'sockjs' | 'raw'): Promise<DDPClient> {
    let sockPath = 'websocket';

    if (encapsulation == 'sockjs') {
      const shardId = Math.floor(Math.random()*1000);
      const sessionId = Math.random().toString(16).slice(2, 10);
      sockPath = `sockjs/${shardId}/${sessionId}/${sockPath}`;
    }

    const sockUrl = new URL(sockPath, appUrl);
    sockUrl.protocol = sockUrl.protocol.replace(/^http/, 'ws');
    const wss = new WebSocketStream(sockUrl.toString());

    const connectSpan = clientTracer.startSpan('DDP connection');
    const {readable, writable} = await wss.opened.finally(() => connectSpan.end());

    // TODO: typecheck readable
    const ddp = new this(wss, readable as ReadableStream<string>, writable, encapsulation);
    await ddp.runHandshake();
    ddp.runInboundLoop(); // throw away the promise (it's fine)
    return ddp;
  }
}

// function handleDocumentPacket(coll: LiveCollection, packet: ServerSentPacket & { msg: "added" | "changed" | "removed" | "addedBefore" | "movedBefore"}) {
//   switch (packet.msg) {
//     case 'added': {
//       coll.addDocument(packet.id, packet.fields ?? {});
//     }; break;
//     case 'addedBefore':
//       throw new Error(`TODO: DDP subscription ordering is not implemented`);
//     case 'changed': {
//       coll.changeDocument(packet.id, packet.fields ?? {}, packet.cleared ?? []);
//     }; break;
//     case 'movedBefore':
//       throw new Error(`TODO: DDP subscription ordering is not implemented`);
//     case 'removed': {
//       coll.removeDocument(packet.id);
//     }; break;
//   }
// }
