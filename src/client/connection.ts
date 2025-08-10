import type { EJSONableProperty } from "@cloudydeno/ejson";
import { SpanKind, trace } from "@cloudydeno/opentelemetry/pkg/api";

import type { ServerSentSubscriptionPacket } from "../lib/types.ts";
import { LiveVariable } from "../lib/live-variable.ts";

import type { Collection, HasId } from "../livedata/types.ts";
import { RemoteCollection } from "../livedata/collections/remote.ts";
import { DdpClientSocket } from "./socket.ts";
import { openWebsocketStream, runHandshake } from "./_open.ts";
import type { ConnectionOptions, ConnectionStatus, DdpSubscription } from "./types.ts";
import { type AsyncHandle, createAsyncHandle } from "./_async.ts";

type DesiredSubscription = {
  name: string;
  params: EJSONableProperty[];
  // context: Context;
  async: AsyncHandle;
  // readyPromise: Promise<void>;
  ready: LiveVariable<boolean>;
};

type SocketAttempt = {
  socket: DdpClientSocket;
  abortCtlr: AbortController;
  promise: Promise<void>;
}

const methodTracer = trace.getTracer('ddp.method');
const subTracer = trace.getTracer('ddp.subscription');

export class DdpConnection {

  constructor(
    public readonly appUrl: string,
    public readonly opts: ConnectionOptions,
  ) {
    if (opts.autoConnect) {
      // TODO: autconnect
      this.#createSocket();
    }
  }

  private readonly collections: Map<string, RemoteCollection> = new Map;
  private readonly desiredSubs: Map<string, DesiredSubscription> = new Map;

  public liveStatus: LiveVariable<ConnectionStatus> = new LiveVariable({
    connected: false,
    status: 'offline',
    retryCount: 0,
  });
  /** Not reactive. Use liveStatus.subscribe() to observe updates. */
  public get status(): ConnectionStatus {
    return this.liveStatus.getSnapshot();
  }
  private patchStatus(updates: Partial<ConnectionStatus>) {
    this.liveStatus.setSnapshot({
      ...this.liveStatus.getSnapshot(),
      ...updates,
    });
  }

  private currentAttempt: SocketAttempt | null = null;
  private currentSocket: DdpClientSocket | null = null;
  private ensureNoActiveSocket(reason?: string) {
    if (this.currentAttempt) {
      // I don't think this needs to be an Error.
      // Leaving in for now in case the stack trace becomes helpful.
      this.currentAttempt.abortCtlr.abort(new Error(reason || 'ensureNoActiveSocket'));
      this.currentAttempt = null;
    }
    if (this.currentSocket) {
      this.currentSocket = null;
      for (const sub of this.desiredSubs.values()) {
        sub.ready.setSnapshot(false);
      }
    }
    if (this.status.connected || this.status.status == 'connecting') {
      this.patchStatus({
        connected: false,
        status: 'offline',
        reason,
      });
    }
  }
  private switchToNewSocket(attempt: SocketAttempt) {
    this.ensureNoActiveSocket();

    this.currentAttempt = attempt;
    if (this.status.status !== 'connecting') {
      this.patchStatus({
        status: 'connecting',
        connected: false,
      });
    }

    attempt.promise.then(() => {
      if (attempt != this.currentAttempt) return;
      this.currentAttempt = null;
      this.currentSocket = attempt.socket;

      this.liveStatus.setSnapshot({
        status: 'connected',
        connected: true,
        retryCount: 0,
      });

      for (const [subId, sub] of this.desiredSubs.entries()) {
        attempt.socket.subscribe(subId, sub.async, sub.name, sub.params);
      }
      for (const item of this.offlineQueue) switch (item.op) {
        case 'ping': attempt.socket.sendPing(item.pingId, item.async); break;
        case 'method': attempt.socket.sendMethod(item.async, item.methodId, item.name, item.params); break;
      }
      this.offlineQueue.length = 0;
    }).catch(err => {
      if (typeof err == 'object') {
        console.error(`WARNING: DDP connection attempt failed, will retry:`, err.message);
      }
      // this.currentAttempt = null;
      const backoffMillis = 10_000;
      this.liveStatus.setSnapshot({
        status: 'waiting',
        connected: false,
        retryCount: this.status.retryCount + 1,
        reason: err.message,
        retryTimeNumber: Date.now() + backoffMillis,
      }
    );
      const timer = setTimeout(() => {
        this.currentAttempt = null;
        this.connect();
      }, backoffMillis);
      this.currentAttempt!.abortCtlr.signal.addEventListener('abort', () => {
        clearTimeout(timer);
      });
    });
  }

  /**
   * Intended for `using` statements. Shuts down the client as disposal.
   */
  async [Symbol.dispose]() {
    this.disconnect();
  }


  private grabCollection(collectionName: string): RemoteCollection {
    let coll = this.collections.get(collectionName);
    if (!coll) {
      coll = new RemoteCollection(this, collectionName);
      this.collections.set(collectionName, coll);
    }
    return coll;
  }
  public getCollection<T extends HasId>(collectionName: string): Collection<T> {
    const coll = this.grabCollection(collectionName);
    return coll.getApi<T>();
  }

  callMethod<T=EJSONableProperty>(name: string, params: EJSONableProperty[]): Promise<T> {
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
    const async = createAsyncHandle<T>(span);

    if (this.currentSocket) {
      this.currentSocket.sendMethod(async, methodId, name, params);
    } else {
      this.offlineQueue.push({
        op: 'method', methodId,
        async: async as AsyncHandle<unknown> as AsyncHandle<void>,
        name, params,
      });
    }

    return async.promise;
  }

  ping(): Promise<void> {
    const pingId = Math.random().toString(16).slice(2);
    const async = createAsyncHandle(null);
    if (this.currentSocket) {
      this.currentSocket.sendPing(pingId, async);
    } else {
      this.offlineQueue.push({ op: 'ping', pingId, async });
    }
    return async.promise;
  }

  offlineQueue: Array<
    | { async: AsyncHandle, op: 'ping', pingId: string }
    | { async: AsyncHandle, op: 'method', methodId: string, name: string, params: EJSONableProperty[] }
  > = [];

  subscribe(name: string, params: EJSONableProperty[] = []): DdpSubscription {
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

    const desiredSub: DesiredSubscription = {
      name, params,
      ready: new LiveVariable(false),
      // TODO: store nosub error: new LiveVariable(error),
      async: createAsyncHandle(span),
    };
    this.desiredSubs.set(subId, desiredSub);
    this.currentSocket?.subscribe(subId, desiredSub.async, name, params);
    return {
      liveReady: desiredSub.ready,
      subId,
      stop: () => {
        const wasLive = this.desiredSubs.delete(subId);
        if (!wasLive) return;
        this.currentSocket?.sendMessage({
          msg: 'unsub',
          id: subId,
        });
      },
    };
  }

  // TODO: understand why this is async, is async still needed?
  // deno-lint-ignore require-await
  public async handleLivedataPacket(packet: ServerSentSubscriptionPacket): Promise<void> {
    // console.debug('C<-', Deno.inspect(packet, { depth: 1 }));
    switch (packet.msg) {
      // case 'updated':
      //   // We don't do client-side simulations so this isn't important
      //   break;

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

      case 'ready':
        for (const subId of packet.subs) {
          const sub = this.desiredSubs.get(subId);
          if (!sub) continue; // assert?
          sub.ready.setSnapshot(true);
        }
        break;
      case 'nosub':
        {
          const sub = this.desiredSubs.get(packet.id);
          if (!sub) break; // assert?
          sub.ready.setSnapshot(false);
        }
        break;

      default:
        console.log('<---', packet);
    }
  }

  connect(opts: {
    /** Immediately retry if a connection is already desired but not healthy */
    allowRetry?: boolean;
  } = {}) {
    const { status } = this.status;
    if (status == 'connected') return;
    if (status !== 'offline') {
      // if currently trying, in backoff, etc
      // then no-op unless a retry is specifically requested
      if (!opts.allowRetry) return;
    }
    this.#createSocket();
  }
  disconnect() {
    if (this.status.status == 'offline') return;
    this.currentSocket?.writer?.close();
    this.currentSocket?.shutdown();
    this.ensureNoActiveSocket(`client was manually disconnected`);
  }

  #createSocket() {
    this.ensureNoActiveSocket();
    // if (this.currentSocket) throw new Error(`have socket already`);
    // this.currentStatus = { ...this.currentStatus, connected: false, status: 'connecting' };
    const ddp = new DdpClientSocket(
      this.handleLivedataPacket.bind(this),
      this.opts.encapsulation);

    const factory = this.opts.dialerFunc ?? openWebsocketStream;

    // store setupPromise to 'lock' our connection attempt
    const abortCtlr = new AbortController;
    this.switchToNewSocket({
      socket: ddp,
      abortCtlr,
      promise:
        factory({
          appUrl: this.appUrl,
          encapsulation: this.opts.encapsulation,
          headers: this.opts.additionalHeaders,
          signal: abortCtlr.signal,
        })
        .then(async ({ readable, writable }) => {
          ddp.writer = writable.getWriter();
          await runHandshake(ddp, readable as ReadableStream<string>);
          ddp.runInboundLoop(readable as ReadableStream<string>); // throw away the promise (it's fiiine)
        }),
    })
    // const setupPromise = ;
    // setupPromise.then(() => {
    //   this.currentStatus = { ...this.currentStatus, connected: true, status: 'connected' };
    // });
    return ddp;
  }

  // /** Intended for test purposes */
  // // TODO: remove in favor of a testing subclass
  // async connectToStreams(streams: {
  //   readable: ReadableStream<string>;
  //   writable: WritableStream<string>;
  // }): Promise<DdpClientSocket> {

  //   this.switchToSocket()

  //   if (this.currentSocket) throw new Error(`have socket already`);
  //   this.currentStatus = { ...this.currentStatus, connected: false, status: 'connecting' };
  //   const ddp = this.currentSocket = new DdpClientSocket(
  //     this.handleLivedataPacket.bind(this),
  //     this.opts.encapsulation);
  //   ddp.writer = streams.writable.getWriter();
  //   await runHandshake(ddp, streams.readable as ReadableStream<string>);
  //   ddp.runInboundLoop(streams.readable as ReadableStream<string>); // throw away the promise (it's fiiine)
  //   this.currentStatus = { ...this.currentStatus, connected: true, status: 'connected' };
  //   return ddp;
  // }


  // static async connect(appUrl: string, opts?: ConnectionOptions): Promise<DdpConnection> {
    // let sockPath = 'websocket';

    // if (encapsulation == 'sockjs') {
    //   const shardId = Math.floor(Math.random()*1000);
    //   const sessionId = Math.random().toString(16).slice(2, 10);
    //   sockPath = `sockjs/${shardId}/${sessionId}/${sockPath}`;
    // }

    // const sockUrl = new URL(sockPath, appUrl);
    // sockUrl.protocol = sockUrl.protocol.replace(/^http/, 'ws');
    // const wss = new WebSocketStream(sockUrl.toString());

    // const connectSpan = clientTracer.startSpan('DDP connection');
    // const {readable, writable} = await wss.opened.finally(() => connectSpan.end());

    // // TODO: typecheck readable
    // const ddp = new this(wss, readable as ReadableStream<string>, writable, encapsulation);
    // await ddp.runHandshake();
    // ddp.runInboundLoop(); // throw away the promise (it's fine)
    // return ddp;
  // }
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
