import type { EJSONableProperty } from "@cloudydeno/ejson";

import type { ServerSentSubscriptionPacket } from "lib/types.ts";
import type { Collection, HasId } from "../livedata/types.ts";
import { RemoteCollection } from "../livedata/collections/remote.ts";
import { DdpClientSocket } from "./socket.ts";
import { openWebsocketStream, runHandshake } from "./_open.ts";
import type { ConnectionOptions, ConnectionStatus, DdpSubscription } from "./types.ts";

export class DdpConnection {

  constructor(
    public readonly appUrl: string,
    public readonly opts: ConnectionOptions,
  ) {
    if (opts.autoConnect) {
      this.#createSocket();
    }
  }

  private readonly collections: Map<string, RemoteCollection> = new Map;
  private readonly desiredSubs: Map<string, {
    name: string;
    params: EJSONableProperty[];
    ready: boolean;
  }> = new Map;

  private currentSocket: DdpClientSocket | null = null;
  private currentStatus: ConnectionStatus = {
    connected: false,
    status: 'offline',
    retryCount: 0,
  };
  public status(): ConnectionStatus {
    return structuredClone(this.currentStatus);
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

  async callMethod<T=EJSONableProperty>(name: string, params: EJSONableProperty[]): Promise<T> {
    if (!this.currentSocket) throw new Error(`Not connected and no offline queue`);
    const methodId = Math.random().toString(16).slice(2);
    return await this.currentSocket.callMethod(methodId, name, params);
  }

  async ping(): Promise<void> {
    if (!this.currentSocket) throw new Error(`Not connected and no offline queue`);
    const pingId = Math.random().toString(16).slice(2);
    await this.currentSocket.ping(pingId);
  }

  subscribe(name: string, params: EJSONableProperty[] = []): DdpSubscription {
    if (!this.currentSocket) throw new Error(`Not connected and no offline queue`);
    const subId = Math.random().toString(16).slice(2);
    const readyPromise = this.currentSocket.subscribe(subId, name, params);
    this.desiredSubs.set(subId, {
      name, params,
      ready: false,
    })
    return {
      ready: readyPromise,
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
          sub.ready = true; // reactive?
        }
        break;
      case 'nosub':
        {
          const sub = this.desiredSubs.get(packet.id);
          if (!sub) break; // assert?
          sub.ready = false; // reactive?
        }
        break;

      default:
        console.log('<---', packet);
    }
  }

  #createSocket() {
    if (this.currentSocket) throw new Error(`have socket already`);
    this.currentStatus = { ...this.currentStatus, connected: false, status: 'connecting' };
    const ddp = this.currentSocket = new DdpClientSocket(
      this.handleLivedataPacket.bind(this),
      this.opts.encapsulation);
    // TODO: store setupPromise to 'lock' our connection attempt
    const setupPromise = openWebsocketStream(this.appUrl, this.opts.encapsulation)
      .then(async ({ readable, writable }) => {
        await runHandshake(ddp, readable as ReadableStream<string>);
        ddp.writer = writable.getWriter();
        ddp.runInboundLoop(readable as ReadableStream<string>); // throw away the promise (it's fiiine)
      });
    setupPromise.then(() => {
      this.currentStatus = { ...this.currentStatus, connected: true, status: 'connected' };
    });
    return ddp;
  }

  /** Intended for test purposes */
  async connectToStreams(streams: {
    readable: ReadableStream<string>;
    writable: WritableStream<string>;
  }): Promise<DdpClientSocket> {
    if (this.currentSocket) throw new Error(`have socket already`);
    this.currentStatus = { ...this.currentStatus, connected: false, status: 'connecting' };
    const ddp = this.currentSocket = new DdpClientSocket(
      this.handleLivedataPacket.bind(this),
      this.opts.encapsulation);
    ddp.writer = streams.writable.getWriter();
    await runHandshake(ddp, streams.readable as ReadableStream<string>);
    ddp.runInboundLoop(streams.readable as ReadableStream<string>); // throw away the promise (it's fiiine)
    this.currentStatus = { ...this.currentStatus, connected: true, status: 'connected' };
    return ddp;
  }

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
