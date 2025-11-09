import type { EJSONableProperty } from "@cloudydeno/ejson";

export type FieldValue = EJSONableProperty;
export type DocumentFields = Record<string, FieldValue>;

export type HasId = { _id: string };
export type DocumentWithId = DocumentFields & HasId;

export interface FindOpts {
  fields?: Record<string, boolean | 0 | 1>;
}
export interface UpdateOpts {
  multi?: boolean;
  upsert?: boolean;
}
export interface UpsertOpts {
  multi?: boolean;
}
export interface UpsertResult {
  numberAffected?: number;
  insertedId?: string;
}

// based on https://github.com/meteor/meteor/blob/devel/packages/mongo/mongo.d.ts

export type OptionalId<TSchema extends HasId> = Omit<TSchema, '_id'> & { _id?: string };

export interface CollectionApi<T extends HasId> extends AsyncCollection<T>, SyncCollection<T> {
  get collectionName(): string | null;
  find(selector?: Record<string,unknown>, opts?: FindOpts): CursorApi<T>;
}

export interface PartialCollectionApi<T extends HasId> extends Partial<AsyncCollection<T>>, Partial<SyncCollection<T>> {
  find(selector?: Record<string,unknown>, opts?: FindOpts): PartialCursorApi<T>;
}

export interface AsyncCollection<T extends HasId> {
  get collectionName(): string | null;
  findOneAsync(selector?: Record<string,unknown>, opts?: FindOpts): Promise<T | null>;
  insertAsync(
    doc: OptionalId<T>,
  ): Promise<string>;
  updateAsync(
    selector: Record<string,unknown>,
    modifier: Record<string,unknown>,
    options?: UpdateOpts,
  ): Promise<number>;
  upsertAsync(
    selector: Record<string,unknown>,
    modifier: Record<string,unknown>,
    options?: UpsertOpts,
  ): Promise<UpsertResult>;
  removeAsync(
    selector: Record<string,unknown>,
  ): Promise<number>;
}
export interface SyncCollection<T extends HasId> {
  get collectionName(): string | null;
  findOne(selector?: Record<string,unknown>, opts?: FindOpts): T | null;
  insert(
    doc: OptionalId<T>,
  ): string;
  update(
    selector: Record<string,unknown>,
    modifier: Record<string,unknown>,
    options?: UpdateOpts,
  ): number;
  upsert(
    selector: Record<string,unknown>,
    modifier: Record<string,unknown>,
    options?: UpsertOpts,
  ): UpsertResult;
  remove(
    selector: Record<string,unknown>,
  ): number;
}

export interface CursorApi<T extends HasId> extends AsyncCursor<T>, SyncCursor<T> {
}

export interface PartialCursorApi<T extends HasId> extends Partial<AsyncCursor<T>>, Partial<SyncCursor<T>> {
}

export type AsyncCursor<T extends HasId> = {
  /**
   * Returns the number of documents that match a query.
   * @param applySkipLimit If set to `false`, the value returned will reflect the total number of matching documents, ignoring any value supplied for limit. (Default: true)
   */
  countAsync(applySkipLimit?: boolean): Promise<number>;
  /**
   * Return all matching documents as an Array.
   */
  fetchAsync(): Promise<Array<T>>;
  /**
   * Call `callback` once for each matching document, sequentially and
   *          synchronously.
   * @param callback Function to call. It will be called with three arguments: the document, a 0-based index, and <em>cursor</em> itself.
   * @param thisArg An object which will be the value of `this` inside `callback`.
   */
  forEachAsync<Tthis=undefined>(
    callback: (this: Tthis, doc: T, index: number, cursor: CursorApi<T>) => void,
    thisArg?: Tthis
  ): Promise<void>;
  /**
   * Map callback over all matching documents. Returns an Array.
   * @param callback Function to call. It will be called with three arguments: the document, a 0-based index, and <em>cursor</em> itself.
   * @param thisArg An object which will be the value of `this` inside `callback`.
   */
  mapAsync<M,Tthis=undefined>(
    callback: (this: Tthis, doc: T, index: number, cursor: CursorApi<T>) => M,
    thisArg?: Tthis
  ): Promise<Array<M>>;
  /**
   * Watch a query. Receive callbacks as the result set changes.
   * @param callbacks Functions to call to deliver the result set as it changes
   */
  observeAsync(callbacks: ObserveCallbacks<T>): Promise<ObserverHandle/*<T>*/>;
  /**
   * Watch a query. Receive callbacks as the result set changes. Only the differences between the old and new documents are passed to the callbacks.
   * @param callbacks Functions to call to deliver the result set as it changes
   * @param options { nonMutatingCallbacks: boolean }
   */
  observeChangesAsync(
    callbacks: ObserveChangesCallbacks<T>,
    options?: { nonMutatingCallbacks?: boolean | undefined }
  ): Promise<ObserverHandle/*<T>*/>;
};


export type SyncCursor<T extends HasId> = {
  /**
   * Returns the number of documents that match a query.
   * @param applySkipLimit If set to `false`, the value returned will reflect the total number of matching documents, ignoring any value supplied for limit. (Default: true)
   */
  count(applySkipLimit?: boolean): number;
  /**
   * Return all matching documents as an Array.
   */
  fetch(): Array<T>;
  /**
   * Call `callback` once for each matching document, sequentially and
   *          synchronously.
   * @param callback Function to call. It will be called with three arguments: the document, a 0-based index, and <em>cursor</em> itself.
   * @param thisArg An object which will be the value of `this` inside `callback`.
   */
  forEach<Tthis=undefined>(
    callback: (this: Tthis, doc: T, index: number, cursor: CursorApi<T>) => void,
    thisArg?: Tthis
  ): void;
  /**
   * Map callback over all matching documents. Returns an Array.
   * @param callback Function to call. It will be called with three arguments: the document, a 0-based index, and <em>cursor</em> itself.
   * @param thisArg An object which will be the value of `this` inside `callback`.
   */
  map<M,Tthis=undefined>(
    callback: (this: Tthis, doc: T, index: number, cursor: CursorApi<T>) => M,
    thisArg?: Tthis
  ): Array<M>;
  /**
   * Watch a query. Receive callbacks as the result set changes.
   * @param callbacks Functions to call to deliver the result set as it changes
   */
  observe(callbacks: ObserveCallbacks<T>): ObserverHandle/*<T>*/;
  /**
   * Watch a query. Receive callbacks as the result set changes. Only the differences between the old and new documents are passed to the callbacks.
   * @param callbacks Functions to call to deliver the result set as it changes
   */
  observeChanges(
    callbacks: ObserveChangesCallbacks<T>,
    options?: { nonMutatingCallbacks?: boolean | undefined }
  ): ObserverHandle/*<T>*/;
  [Symbol.iterator](): Iterator<T>;
  [Symbol.asyncIterator](): AsyncIterator<T>;
};

export type ObserverHandle/*<T extends {_id: string}>*/ = {
  stop(): void;
  // readonly collection: CollectionApi<T>;
  // readonly cursor: CursorApi<T>;
}

// export type ObserveCallbacks<T> = {
// // export type KeyedObserveCallbacks<T> = {
//   added?: (document: T) => void;
//   changed?: (newDocument: T, oldDocument: T) => void;
//   removed?: (oldDocument: T) => void;
// // };

// // export type OrderedObserveCallbacks<T> = {
//   addedAt?: (document: T, atIndex: number, before: T | null) => void; // atm unsure if meteor has before arg
//   changedAt?: (newDocument: T, oldDocument: T, atIndex: number) => void;
//   removedAt?: (oldDocument: T, atIndex: number) => void;
//   movedTo?: (document: T, fromIndex: number, toIndex: number, before: T | null) => void;
// // };
// };

// export type ObserveCallbacks<T> =
//   | KeyedObserveCallbacks<T>
//   | OrderedObserveCallbacks<T>
// ;


export interface ObserveCallbacks<T> {
  added?(document: T): void;
  addedAt?(document: T, atIndex: number, before: T | null): void;
  changed?(newDocument: T, oldDocument: T): void;
  changedAt?(newDocument: T, oldDocument: T, indexAt: number): void;
  removed?(oldDocument: T): void;
  removedAt?(oldDocument: T, atIndex: number): void;
  movedTo?(
    document: T,
    fromIndex: number,
    toIndex: number,
    before: T | null
  ): void;
}
export interface ObserveChangesCallbacks<T> {
  added?(id: string, fields: Partial<T>): void;
  addedBefore?(id: string, fields: Partial<T>, before: T | null): void;
  changed?(id: string, fields: Partial<T>): void;
  movedBefore?(id: string, before: T | null): void;
  removed?(id: string): void;
}
