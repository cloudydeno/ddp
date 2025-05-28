import { type EJSONableProperty } from "@cloudydeno/ejson";
export type FieldValue = EJSONableProperty;
export type DocumentFields = Record<string, FieldValue>;

export type HasId = { _id: string };
export type DocumentWithId = DocumentFields & HasId;

export interface Collection<T extends {_id: string}> {
  findOne(selector?: Record<string,unknown>, opts?: FindOpts): T | null;
  find(selector?: Record<string,unknown>, opts?: FindOpts): Cursor<T>;
}

export interface FindOpts {
  fields?: Record<string, boolean>;
}

export type Cursor<T extends {_id: string}> = {
  // [Symbol.iterator]: () => Generator<T>;
  // count(applySkipLimit?: boolean): number;
  // countAsync(applySkipLimit?: boolean): Promise<number>;
  // fetch(): Array<T>;
  // fetchAsync(): Promise<Array<T>>;
  // forEach(): void;
  // observe(cbs: ObserveCallbacks<T>): ObserverHandle<T>;

  /**
   * Returns the number of documents that match a query.
   * @param applySkipLimit If set to `false`, the value returned will reflect the total number of matching documents, ignoring any value supplied for limit. (Default: true)
   */
  count(applySkipLimit?: boolean): number;
  /**
   * Returns the number of documents that match a query.
   * @param applySkipLimit If set to `false`, the value returned will reflect the total number of matching documents, ignoring any value supplied for limit. (Default: true)
   */
  countAsync(applySkipLimit?: boolean): Promise<number>;
  /**
   * Return all matching documents as an Array.
   */
  fetch(): Array<T>;
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
  forEach(
    callback: (doc: T, index: number, cursor: Cursor<T>) => void,
    thisArg?: any
  ): void;
  /**
   * Call `callback` once for each matching document, sequentially and
   *          synchronously.
   * @param callback Function to call. It will be called with three arguments: the document, a 0-based index, and <em>cursor</em> itself.
   * @param thisArg An object which will be the value of `this` inside `callback`.
   */
  forEachAsync(
    callback: (doc: T, index: number, cursor: Cursor<T>) => void,
    thisArg?: any
  ): Promise<void>;
  /**
   * Map callback over all matching documents. Returns an Array.
   * @param callback Function to call. It will be called with three arguments: the document, a 0-based index, and <em>cursor</em> itself.
   * @param thisArg An object which will be the value of `this` inside `callback`.
   */
  map<M>(
    callback: (doc: T, index: number, cursor: Cursor<T>) => M,
    thisArg?: any
  ): Array<M>;
  /**
   * Map callback over all matching documents. Returns an Array.
   * @param callback Function to call. It will be called with three arguments: the document, a 0-based index, and <em>cursor</em> itself.
   * @param thisArg An object which will be the value of `this` inside `callback`.
   */
  mapAsync<M>(
    callback: (doc: T, index: number, cursor: Cursor<T>) => M,
    thisArg?: any
  ): Promise<Array<M>>;
  /**
   * Watch a query. Receive callbacks as the result set changes.
   * @param callbacks Functions to call to deliver the result set as it changes
   */
  observe(callbacks: ObserveCallbacks<T>): ObserverHandle<T>;
  /**
   * Watch a query. Receive callbacks as the result set changes.
   * @param callbacks Functions to call to deliver the result set as it changes
   */
  observeAsync(callbacks: ObserveCallbacks<T>): Promise<ObserverHandle<T>>;
  /**
   * Watch a query. Receive callbacks as the result set changes. Only the differences between the old and new documents are passed to the callbacks.
   * @param callbacks Functions to call to deliver the result set as it changes
   */
  observeChanges(
    callbacks: ObserveChangesCallbacks<T>,
    options?: { nonMutatingCallbacks?: boolean | undefined }
  ): ObserverHandle<T>;
  [Symbol.iterator](): Iterator<T>;
  [Symbol.asyncIterator](): AsyncIterator<T>;
  /**
   * Watch a query. Receive callbacks as the result set changes. Only the differences between the old and new documents are passed to the callbacks.
   * @param callbacks Functions to call to deliver the result set as it changes
   * @param options { nonMutatingCallbacks: boolean }
   */
  observeChangesAsync(
    callbacks: ObserveChangesCallbacks<T>,
    options?: { nonMutatingCallbacks?: boolean | undefined }
  ): Promise<ObserverHandle<T>>;
};

export type ObserverHandle<T extends {_id: string}> = {
  stop(): void;
  readonly collection: Collection<T>;
  readonly cursor: Cursor<T>;
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
