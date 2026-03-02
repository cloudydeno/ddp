import type { MeteorError, DocumentFields } from "lib/types.ts";
import type { DdpSession } from "./session.ts";
import type { OutboundSubscription, PublishStream } from "./types.ts";

export class DdpSessionSubscription implements OutboundSubscription {
  async _start(): Promise<void> {
    await this.opts.startFunc()
      .then(result => {
        if (Array.isArray(result)) {
          emitToSub(this, result);
        } else if (result) {
          emitToSub(this, [result]);
        }
      })
      // TODO: server error sanitizing
      .catch(err => this.error(err));
  }
  constructor(
    public readonly connection: DdpSession,
    private readonly opts: {
      subId: string;
      pubName: string;
      startFunc: () => Promise<void | PublishStream | PublishStream[]>;
    },
  ) {}
  public readonly stopCtlr: AbortController = new AbortController();

  public dependsOnUserId = false;

  unblock(): void {
    throw new Error("Method not implemented.");
  }

  _recreate(): DdpSessionSubscription {
    return new DdpSessionSubscription(this.connection, this.opts);
  }

  public stop(error?: MeteorError) {
    if (this.opts.subId) { // named subs
      if (!this.connection.namedSubs.delete(this.opts.subId)) return;
      for (const collection of this.connection.collections.values()) {
        collection.dropSub(this.opts.subId);
      }
      this.connection.send([{
        msg: 'nosub',
        id: this.opts.subId,
        error,
      }]);
    }
    this.stopCtlr.abort(error ? 'Subscription error' : 'Stop requested');
  }
  public onStop(callback: () => void) {
    this.stopCtlr.signal.addEventListener('abort', callback);
  }
  get signal(): AbortSignal {
    return this.stopCtlr.signal;
  }

  get userId(): string | null {
    this.dependsOnUserId = true;
    return this.connection.userId;
  }

  public added(collection: string, id: string, fields: DocumentFields): void {
    if (this.stopCtlr.signal.aborted) return;
    this.connection.getCollection(collection).added(this.opts.subId, id, fields);
  }
  public changed(collection: string, id: string, fields: DocumentFields): void {
    if (this.stopCtlr.signal.aborted) return;
    this.connection.getCollection(collection).changed(this.opts.subId, id, fields);
  }
  public removed(collection: string, id: string): void {
    if (this.stopCtlr.signal.aborted) return;
    this.connection.getCollection(collection).removed(this.opts.subId, id);
  }

  public error(error: Error): void {
    if (this.stopCtlr.signal.aborted) return;
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
    if (this.stopCtlr.signal.aborted) return;
    if (!this.opts.subId) return; // universal subs
    if (this.connection._isSending) {
      this.connection.send([{
        msg: 'ready',
        subs: [this.opts.subId],
      }]);
    } else {
      this.connection._pendingReady.push(this.opts.subId);
    }
  }
}

function emitToSub(
  sub: OutboundSubscription,
  sources: Array<PublishStream>,
) {
  let unreadyCount = sources.length;
  if (unreadyCount == 0) {
    sub.ready();
    return;
  }
  sources.map(source => source.pipeTo(new WritableStream({
    write(packet) {
      switch (packet.msg) {
        case 'ready':
          if (--unreadyCount == 0) {
            sub.ready();
          }
          break;
        case 'nosub':
          if (packet.error) {
            throw packet.error;
          } else {
            sub.stop();
          }
          break;
        case 'added':
          sub.added(packet.collection, packet.id, packet.fields ?? {});
          break;
        case 'changed':
          sub.changed(packet.collection, packet.id, packet.fields ?? {});
          break;
        case 'removed':
          sub.removed(packet.collection, packet.id);
          break;
      }
    },
  })));
}
