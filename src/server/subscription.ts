import type { OutboundSubscription, MeteorError, DocumentFields } from "lib/types.ts";
import type { DdpSession } from "./session.ts";

export class DdpSessionSubscription implements OutboundSubscription {
  constructor(
    public readonly connection: DdpSession,
    private readonly subId: string,
  ) {}
  public readonly stopCtlr: AbortController = new AbortController();

  unblock(): void {
    throw new Error("Method not implemented.");
  }

  public stop(error?: MeteorError) {
    if (!this.connection.namedSubs.delete(this.subId)) return;
    for (const collection of this.connection.collections.values()) {
      collection.dropSub(this.subId);
    }
    if (this.subId) {
      this.connection.send([{
        msg: 'nosub',
        id: this.subId,
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
    if (!this.subId) return; // universal subs
    this.connection.send([{
      msg: 'ready',
      subs: [this.subId],
    }]);
  }
}
