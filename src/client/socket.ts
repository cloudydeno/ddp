import { EJSON, type EJSONableProperty } from "@cloudydeno/ejson";
import { trace, SpanKind, SpanStatusCode, type Span, context, propagation, type Context } from "@cloudydeno/opentelemetry/pkg/api";

import type { ClientSentPacket, ServerSentSubscriptionPacket, ServerSentPacket } from "lib/types.ts";
// import { openWebsocketStream, runHandshake } from "./_open.ts";

// const clientTracer = trace.getTracer('ddp.client');
const methodTracer = trace.getTracer('ddp.method');
const subTracer = trace.getTracer('ddp.subscription');

export class DdpClientSocket {
  constructor(
    private readonly livedataCb: (packet: ServerSentSubscriptionPacket) => void,
    // private readonly readable: ReadableStream<string>,
    // private readonly writable: WritableStream<string>,
    public readonly encapsulation: 'sockjs' | 'raw',
  ) {
    // this.writer = this.writable.getWriter();
  }
  public writer: WritableStreamDefaultWriter<string> | null = null;

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

  async callMethod<T=EJSONableProperty>(methodId: string, name: string, params: EJSONableProperty[]): Promise<T> {
    if (this.pendingMethods.has(methodId)) throw new Error(`BUG: duplicated methodId`);

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

    // console.debug('--> call', name);
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

  async ping(pingId: string) {
    if (this.pendingPings.has(pingId)) throw new Error(`BUG: duplicated pingId`);

    await new Promise<void>((ok, fail) => {
      this.pendingPings.set(pingId, {ok, fail});
      this.sendMessage({
        msg: 'ping',
        id: pingId,
      }).catch(fail);
    });
  }

  subscribe(subId: string, name: string, params: EJSONableProperty[] = []): Promise<void> {
    if (this.pendingSubs.has(subId)) throw new Error(`BUG: duplicated subId`);
    if (this.readySubs.has(subId)) throw new Error(`BUG: duplicated subId`);

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

    // console.debug('--> sub', name, params);
    const readyPromise = new Promise<void>((ok, fail) => {
      this.pendingSubs.set(subId, {ok, fail, span});
      this.sendMessage({
        msg: 'sub',
        id: subId,
        name: name,
        params: params,
      }, trace.setSpan(context.active(), span)).catch(fail);
    });
    return readyPromise;
  }

  async runInboundLoop(readable: ReadableStream<string>): Promise<void> {
    if (this.encapsulation == 'raw') {
      for await (const chunk of readable) {
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

    for await (const chunk of readable) switch (chunk[0]) {
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
        this.livedataCb(packet);
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
          this.livedataCb(packet);
        } else if (this.readySubs.delete(packet.id)) {
          // Any sort of cleanup for ready subs?
          this.livedataCb(packet);
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
      case 'changed':
      case 'removed':
      case 'addedBefore':
      case 'movedBefore':
        this.livedataCb(packet);
        break;

      default:
        console.log('<--', packet);
    }
  }

  async sendMessage(packet: ClientSentPacket, traceContext?: Context): Promise<void> {
    if (!this.writer) throw new Error(`not connected, no writer`);

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
}

// function handleDocumentPacket(coll: LiveCollection, packet: ServerSentDocumentPacket) {
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
