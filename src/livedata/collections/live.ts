import sift from "sift";

import type { PartialCollectionApi, PartialCursorApi, DocumentFields, FindOpts, HasId, ObserveCallbacks, ObserverHandle } from "../types.ts";
import { makeReturnDoc } from "../document.ts";

type FilterFunc = (item: unknown, key?: string | number | undefined, owner?: unknown) => boolean;

export abstract class LiveCollection {
  public readonly fields: Map<string,DocumentFields> = new Map;

  addDocument(id: string, fields: DocumentFields): void {
    if (!id) throw new Error(`BUG: tried adding document with falsey id`);
    if (this.fields.has(id)) throw new Error(`BUG: ID "${id}" already exists`);
    this.fields.set(id, fields);

    // const queriesToRecompute = [];

    // trigger live queries that match
    for (const query of this.queries) {
      if (query.dirty) {
        continue;
      }

      const matchResult = query.selector({ id, ...fields });
      if (matchResult) {
        // if (query.cursor.skip || query.cursor.limit) {
        //   queriesToRecompute.push(qid);
        // } else {
        query.cbs.added?.(makeReturnDoc(id, fields as HasId, query.opts));
          // LocalCollection._insertInResultsSync(query, doc);
        // }
      }
    }

    // queriesToRecompute.forEach(qid => {
    //   if (this.queries[qid]) {
    //     this._recomputeResults(this.queries[qid]);
    //   }
    // });

    // this._observeQueue.drain();
  }
  changeDocument(id: string, fields: DocumentFields, cleared: Array<string>): void {
    if (!id) throw new Error(`BUG: tried changing document with falsey id`);
    this.fields.set(id, {
      ...this.fields.get(id),
      ...(fields ?? {}),
      ...Object.fromEntries(Object.entries(cleared ?? {}).map(x => [x[0], undefined])),
    });
  }
  removeDocument(id: string): void {
    const prevFields = this.fields.get(id);
    if (!prevFields) throw new Error(`BUG: removeDocument ${id} without existing fields`);
    this.fields.delete(id);

    // trigger live queries that match
    for (const query of this.queries) {
      if (query.dirty) {
        continue;
      }

      const matchResult = query.selector({_id: id, ...prevFields});
      if (matchResult) {
        query.cbs.removed?.(makeReturnDoc(id, prevFields as HasId, query.opts));
      }
    }
  }

  // private nextObserverId = 0;
  private readonly queries: Set<LiveQuery<HasId>> = new Set;
  addQuery(obs: LiveQuery<HasId>): void {
    // const obsId = ++this.nextObserverId;
    this.queries.add(obs);
    obs.stopCtlr.signal.addEventListener('abort', () => {
      this.queries.delete(obs);
    })
  }

  *findGenerator<T extends HasId>(selector: FilterFunc, opts: FindOpts): Generator<T> {
    // if (opts.sort) throw new Error(`TODO: find sorting`);
    for (const [_id, fields] of this.fields) {
      if (selector({_id, ...fields})) {
        yield makeReturnDoc(_id, fields as T, opts);
      }
    }
  }

}

export class LiveCollectionApi<T extends HasId> implements PartialCollectionApi<T> {
  constructor(
    public readonly liveColl: LiveCollection,
  ) {}

  findOneAsync(selector?: Record<string, unknown>, opts?: FindOpts): Promise<T | null> {
    return Promise.try(() => this.findOne(selector, opts));
  }

  findOne(selector: Record<string,unknown> = {}, opts: FindOpts = {}): T | null {
    for (const doc of this.liveColl.findGenerator<T>(sift.default(selector), opts)) {
      return doc;
    }
    return null;
  }

  find(selector: Record<string,unknown> = {}, opts?: FindOpts): PartialCursorApi<T> {
    return new LiveCursor<T>(this, selector, opts ?? {});
  }
}

export class LiveCursor<T extends HasId> implements PartialCursorApi<T>, Iterable<T> {
  constructor(
    private readonly coll: LiveCollectionApi<T>,
    private readonly selector: Record<string,unknown>,
    private readonly opts: FindOpts,
  ) {
    this.filterFunc = sift.default(this.selector);
  }
  private readonly filterFunc: FilterFunc;

  count(_applySkipLimit?: boolean): number {
    let count = 0;
    for (const _ of this) {
      count++;
    }
    return count;
  }

  [Symbol.iterator](): Iterator<T> {
    return this.coll.liveColl.findGenerator<T>(this.filterFunc, this.opts);
  }
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (const x of this) yield x;
  }

  fetch(): T[] {
    return Array.from(this);
  }
  observe(cbs: ObserveCallbacks<T>): ObserverHandle {
    const query = new LiveQuery<T>(this.coll, sift.default(this.selector), this.opts, cbs);
    // this.coll.liveColl.addQuery(query);
    return {
      stop: () => {
        query.stopCtlr.abort();
      },
    };
  }
  // observeChanges(callbacks: ObserveChangesCallbacks<T>, options?: { nonMutatingCallbacks?: boolean | undefined; }): ObserverHandle {
  //   throw new Error("TODO: Method 'observeChanges' not implemented.");
  // }
}

export class LiveQuery<T extends HasId> {
  constructor(
    public readonly coll: LiveCollectionApi<T>,
    public readonly selector: FilterFunc,
    public readonly opts: FindOpts,
    public readonly cbs: ObserveCallbacks<T>,
  ) {
    for (const item of this.coll.liveColl.findGenerator<T>(this.selector, this.opts)) {
      this.cbs.added?.(item);
    }
    coll.liveColl.addQuery(this);
  }
  public dirty = false;
  public readonly stopCtlr: AbortController = new AbortController;
  // makeHandle(): ObserverHandle<T> {
  //   // return new CursorObserverHandle(this.collection, this.stopCtlr);
  //   return {
  //     collection: this.coll,
  //     stop: () => {
  //       this.stopCtlr.abort();
  //     },
  //   };
  // }
}

// class CursorObserverHandle<T extends HasId> implements ObserverHandle<T> {
//   constructor(
//     public readonly collection: CollectionApi<T>,
//     private readonly stopCtlr: AbortController,
//   ) {}
//   stop(): void {
//     this.stopCtlr.abort();
//   }
// }
