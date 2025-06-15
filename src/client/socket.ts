import { EJSON, type EJSONableProperty } from "@cloudydeno/ejson";
import { trace, SpanStatusCode, context, propagation, type Context } from "@cloudydeno/opentelemetry/pkg/api";

import type { ClientSentPacket, ServerSentSubscriptionPacket, ServerSentPacket } from "lib/types.ts";
import { type AsyncHandle, createAsyncHandle } from "./_async.ts";
// import { openWebsocketStream, runHandshake } from "./_open.ts";

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

  private readonly pendingMethods: Map<string, AsyncHandle<unknown>> = new Map;
  private readonly pendingPings: Map<string, AsyncHandle<void>> = new Map;
  private readonly pendingSubs: Map<string, AsyncHandle<void>> = new Map;
  private readonly readySubs: Set<string> = new Set;

  shutdown() {
    const reason = new Error(`DDP socket is shutting down`);
    for (const method of this.pendingMethods.values()) {
      method.fail(reason);
    }
    for (const ping of this.pendingPings.values()) {
      ping.fail(reason);
    }
  }

  async callMethod<T=EJSONableProperty>(name: string, params: EJSONableProperty[]): Promise<T> {
    const methodId = Math.random().toString(16).slice(2);
    const async = createAsyncHandle<T>(null);
    await this.sendMethod(async, methodId, name, params);
    return await async.promise;
  }
  sendMethod<T=EJSONableProperty>(async: AsyncHandle<T>, methodId: string, name: string, params: EJSONableProperty[]): Promise<void> {
    if (this.pendingMethods.has(methodId)) {
      throw new Error(`BUG: duplicated methodId`);
    }
    // console.debug('--> call', name);
    this.pendingMethods.set(methodId, async as AsyncHandle<unknown>);

    return this.sendMessage({
      msg: 'method',
      id: methodId,
      method: name,
      params: params,
    }, async.span
      ? trace.setSpan(context.active(), async.span)
      : context.active()
    ).catch(async.fail);
  }

  async ping() {
    const pingId = Math.random().toString(16).slice(2);
    const async = createAsyncHandle(null);
    await this.sendPing(pingId, async);
    await async.promise;
  }
  sendPing(pingId: string, async: AsyncHandle<void>): Promise<void> {
    if (this.pendingPings.has(pingId)) {
      throw new Error(`BUG: duplicated pingId`);
    }
    this.pendingPings.set(pingId, async);

    return this.sendMessage({
      msg: 'ping',
      id: pingId,
    }).catch(async.fail);
  }

  subscribe(subId: string, async: AsyncHandle<void>, name: string, params: EJSONableProperty[] = []): void {
    if (this.pendingSubs.has(subId)) throw new Error(`BUG: duplicated subId`);
    if (this.readySubs.has(subId)) throw new Error(`BUG: duplicated subId`);

    const subContext = async.span
      ? trace.setSpan(context.active(), async.span)
      : context.active();

    // console.debug('--> sub', name, params);
    this.pendingSubs.set(subId, async);
    this.sendMessage({
      msg: 'sub',
      id: subId,
      name: name,
      params: params,
    }, subContext).catch(async.fail);
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
          handlers.span?.end();
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
          handlers.span?.setStatus({ code: SpanStatusCode.ERROR, message }).end();
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

  public async sendMessage(packet: ClientSentPacket, traceContext?: Context): Promise<void> {
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
