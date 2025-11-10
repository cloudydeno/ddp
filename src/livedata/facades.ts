import type { HasId, FindOpts, OptionalId, UpdateOpts, UpsertOpts, UpsertResult, CollectionApi, CursorApi, PartialCollectionApi, ObserveCallbacks, ObserveChangesCallbacks, ObserverHandle, PartialCursorApi } from "./types.ts";

/**
 * Wraps a Collection implementation to provide all possible methods.
 * Async methods will fall back to sync implementations if needed.
 *
 * If a called method is not implemented by the low level collection,
 * an Error will be thrown to the caller.
 */
export class Collection<T extends HasId> implements CollectionApi<T> {
  constructor(
    private readonly backingApi: PartialCollectionApi<T>,
    private readonly cursorClass = Cursor,
  ) {}
  get collectionName(): string | null {
    return this.backingApi.collectionName ?? null;
  }
  find(selector?: Record<string, unknown>, opts?: FindOpts): CursorApi<T> {
    return new this.cursorClass(this.backingApi.find(selector, opts));
  }

  async findOneAsync(selector?: Record<string, unknown>, opts?: FindOpts): Promise<T | null> {
    if (this.backingApi.findOneAsync) {
      return this.backingApi.findOneAsync(selector, opts);
    }
    const cursor = this.find(selector, {...opts});
    for await (const doc of cursor) {
      return doc;
    }
    return null;
  }
  insertAsync(doc: OptionalId<T>, callback?: unknown): Promise<string> {
    if (callback) throw new Error(`callback functions are not implemented by this DDP library`);
    if (this.backingApi.insertAsync) {
      return this.backingApi.insertAsync(doc);
    }
    return Promise.try(() => this.insert(doc));
  }
  updateAsync(selector: Record<string, unknown>, modifier: Record<string, unknown>, options?: UpdateOpts, callback?: unknown): Promise<number> {
    if (callback) throw new Error(`callback functions are not implemented by this DDP library`);
    if (this.backingApi.updateAsync) {
      return this.backingApi.updateAsync(selector, modifier, options);
    }
    return Promise.try(() => this.update(selector, modifier, options));
  }
  upsertAsync(selector: Record<string, unknown>, modifier: Record<string, unknown>, options?: UpsertOpts, callback?: unknown): Promise<UpsertResult> {
    if (callback) throw new Error(`callback functions are not implemented by this DDP library`);
    if (this.backingApi.upsertAsync) {
      return this.backingApi.upsertAsync(selector, modifier, options);
    }
    return Promise.try(() => this.upsert(selector, modifier, options));
  }
  removeAsync(selector: Record<string, unknown>, callback?: unknown): Promise<number> {
    if (callback) throw new Error(`callback functions are not implemented by this DDP library`);
    if (this.backingApi.removeAsync) {
      return this.backingApi.removeAsync(selector);
    }
    return Promise.try(() => this.remove(selector));
  }

  findOne(selector?: Record<string, unknown>, opts?: FindOpts): T | null {
    if (this.backingApi.findOne) {
      return this.backingApi.findOne(selector, opts);
    }
    const cursor = this.find(selector, {...opts});
    for (const doc of cursor) {
      return doc;
    }
    return null;
  }
  insert(doc: OptionalId<T>, callback?: unknown): string {
    if (callback) throw new Error(`callback functions are not implemented by this DDP library`);
    if (this.backingApi.insert) {
      return this.backingApi.insert(doc);
    }
    throw new Error("Method 'insert' not implemented.");
  }
  update(selector: Record<string, unknown>, modifier: Record<string, unknown>, options?: UpdateOpts, callback?: unknown): number {
    if (callback) throw new Error(`callback functions are not implemented by this DDP library`);
    if (this.backingApi.update) {
      return this.backingApi.update(selector, modifier, options);
    }
    throw new Error("Method 'update' not implemented.");
  }
  upsert(selector: Record<string, unknown>, modifier: Record<string, unknown>, options?: UpsertOpts, callback?: unknown): UpsertResult {
    if (callback) throw new Error(`callback functions are not implemented by this DDP library`);
    if (this.backingApi.upsert) {
      return this.backingApi.upsert(selector, modifier, options);
    }
    throw new Error("Method 'upsert' not implemented.");
  }
  remove(selector: Record<string, unknown>, callback?: unknown): number {
    if (callback) throw new Error(`callback functions are not implemented by this DDP library`);
    if (this.backingApi.remove) {
      return this.backingApi.remove(selector);
    }
    throw new Error("Method 'remove' not implemented.");
  }
}

/**
 * Wraps a Cursor implementation to provide all possible methods.
 * Async methods will fall back to sync implementations if needed.
 *
 * If a called method is not implemented by the low level cursor,
 * an Error will be thrown to the caller.
 */
export class Cursor<T extends HasId> implements CursorApi<T> {
  constructor(
    private readonly backingApi: PartialCursorApi<T>,
  ) {}
  async countAsync(applySkipLimit?: boolean): Promise<number> {
    if (this.backingApi.countAsync) {
      return await this.backingApi.countAsync(applySkipLimit);
    }
    if (this.backingApi[Symbol.asyncIterator]) {
      let idx = 0;
      for await (const _ of this.backingApi as AsyncIterable<T>) {
        idx++;
      }
      return idx;
    }
    return Promise.try(() => this.count(applySkipLimit));
  }
  async fetchAsync(): Promise<T[]> {
    if (this.backingApi.fetchAsync) {
      return await this.backingApi.fetchAsync();
    }
    if (this.backingApi[Symbol.asyncIterator]) {
      return await Array.fromAsync(this.backingApi as AsyncIterable<T>)
    }
    return Promise.try(() => this.fetch());
  }
  async forEachAsync<Tthis = undefined>(callback: (this: Tthis, doc: T, index: number, cursor: CursorApi<T>) => void, thisArg?: Tthis | undefined): Promise<void> {
    if (this.backingApi.forEachAsync) {
      return await this.backingApi.forEachAsync(callback, thisArg);
    }
    if (this.backingApi[Symbol.asyncIterator]) {
      let idx = 0;
      for await (const item of this.backingApi as AsyncIterable<T>) {
        callback.call(thisArg!, item, idx++, this);
      }
    }
    return Promise.try(() => this.forEach(callback, thisArg));
  }
  async mapAsync<M, Tthis = undefined>(callback: (this: Tthis, doc: T, index: number, cursor: CursorApi<T>) => M, thisArg?: Tthis | undefined): Promise<M[]> {
    if (this.backingApi.mapAsync) {
      return this.backingApi.mapAsync(callback, thisArg);
    }
    if (this.backingApi[Symbol.asyncIterator]) {
      let idx = 0;
      const resp = new Array<M>;
      for await (const item of this.backingApi as AsyncIterable<T>) {
        resp.push(callback.call(thisArg!, item, idx++, this));
      }
      return resp;
    }
    return Promise.try(() => this.map(callback, thisArg));
  }
  observeAsync(callbacks: ObserveCallbacks<T>): Promise<ObserverHandle/*<T>*/> {
    if (this.backingApi.observeAsync) {
      return this.backingApi.observeAsync(callbacks);
    }
    return Promise.try(() => this.observe(callbacks));
  }
  observeChangesAsync(callbacks: ObserveChangesCallbacks<T>, options?: { nonMutatingCallbacks?: boolean | undefined; }): Promise<ObserverHandle/*<T>*/> {
    if (this.backingApi.observeChangesAsync) {
      return this.backingApi.observeChangesAsync(callbacks, options);
    }
    if (this.backingApi.observeAsync) {
      return this.backingApi.observeAsync(observeCbsToChanges(callbacks));
    }
    return Promise.try(() => this.observeChanges(callbacks, options));
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.backingApi[Symbol.asyncIterator]) {
      return this.backingApi[Symbol.asyncIterator]!();
    }
    if (this.backingApi[Symbol.iterator]) {
      const syncIter = this.backingApi[Symbol.iterator]!();
      // TODO: Is this the best way of converting AsyncIterator to Iterator?
      return {
        next: () => Promise.try(() => syncIter.next()),
        return: syncIter.return ? (a: unknown) => Promise.try(() => syncIter.return!(a)) : void 0,
        throw: syncIter.throw ? (e: unknown) => Promise.try(() => syncIter.throw!(e)) : void 0,
      };
    }
    throw new Error("Method [Symbol.asyncIterator] not implemented.");
  }

  count(applySkipLimit?: boolean): number {
    if (this.backingApi.count) {
      return this.backingApi.count(applySkipLimit);
    }
    if (this.backingApi[Symbol.iterator]) {
      let idx = 0;
      for (const _ of this.backingApi as Iterable<T>) {
        idx++;
      }
      return idx;
    }
    throw new Error("Method count not implemented.");
  }
  fetch(): T[] {
    if (this.backingApi.fetch) {
      return this.backingApi.fetch();
    }
    if (this.backingApi[Symbol.iterator]) {
      return Array.from(this.backingApi as Iterable<T>)
    }
    throw new Error("Method fetch not implemented.");
  }
  forEach<Tthis = undefined>(callback: (this: Tthis, doc: T, index: number, cursor: CursorApi<T>) => void, thisArg?: Tthis | undefined): void {
    if (this.backingApi.forEach) {
      return this.backingApi.forEach(callback, thisArg);
    }
    if (this.backingApi[Symbol.iterator]) {
      let idx = 0;
      for (const item of this.backingApi as Iterable<T>) {
        callback.call(thisArg!, item, idx++, this);
      }
    }
    throw new Error("Method forEach not implemented.");
  }
  map<M, Tthis = undefined>(callback: (this: Tthis, doc: T, index: number, cursor: CursorApi<T>) => M, thisArg?: Tthis | undefined): M[] {
    if (this.backingApi.map) {
      return this.backingApi.map(callback, thisArg);
    }
    if (this.backingApi[Symbol.iterator]) {
      let idx = 0;
      const resp = new Array<M>;
      for (const item of this.backingApi as Iterable<T>) {
        resp.push(callback.call(thisArg!, item, idx++, this));
      }
      return resp;
    }
    throw new Error("Method map not implemented.");
  }
  observe(callbacks: ObserveCallbacks<T>): ObserverHandle/*<T>*/ {
    if (this.backingApi.observe) {
      return this.backingApi.observe(callbacks);
    }
    throw new Error("Method observe not implemented.");
  }
  observeChanges(callbacks: ObserveChangesCallbacks<T>, options?: { nonMutatingCallbacks?: boolean | undefined; }): ObserverHandle/*<T>*/ {
    if (this.backingApi.observeChanges) {
      return this.backingApi.observeChanges(callbacks, options);
    }
    if (this.backingApi.observe) {
      return this.backingApi.observe(observeCbsToChanges(callbacks));
    }
    throw new Error("Method observeChanges not implemented.");
  }
  [Symbol.iterator](): Iterator<T> {
    if (this.backingApi[Symbol.iterator]) {
      return this.backingApi[Symbol.iterator]!();
    }
    throw new Error("Method [Symbol.iterator] not implemented.");
  }
}

function observeCbsToChanges<T extends HasId>(callbacks: ObserveChangesCallbacks<T>): ObserveCallbacks<T> {
  return {
    added: callbacks.added ? ({_id,...fields}) => {
      callbacks.added?.(_id, fields as T);
    } : undefined,
    changed: callbacks.changed ? ({_id,...fields}) => {
      callbacks.changed?.(_id, fields as T);
    } : undefined,
    removed: callbacks.removed ? ({_id}) => {
      callbacks.removed?.(_id);
    } : undefined,
  };
}
