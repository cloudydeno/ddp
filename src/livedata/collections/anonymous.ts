import { EJSON, type EJSONable } from "@cloudydeno/ejson";

import type { SyncCollection, HasId, UpdateOpts, UpsertOpts, UpsertResult } from "../types.ts";
import { LiveCollection, LiveCollectionApi } from "./live.ts";
import { Cursor } from "../facades.ts";
import { Random } from "lib/random.ts";

export class AnonymousCollection extends LiveCollection {
  getApi<T extends HasId>(): AnonymousCollectionApi<T> {
    return new AnonymousCollectionApi<T>(this);
  }
}

export class AnonymousCollectionApi<T extends HasId> extends LiveCollectionApi<T> implements SyncCollection<T> {
  get collectionName(): string | null {
    return null;
  }
  insert(doc: T): string {
    let {_id, ...fields} = doc;
    _id ??= new Random().id();
    if (typeof _id != 'string') throw new Error(`Only string IDs are accepted`);
    this.liveColl.addDocument(_id, EJSON.clone(fields as EJSONable));
    return _id;
  }

  update(selector: Record<string, unknown>, modifier: Record<string, unknown>, options?: UpdateOpts): number {
    if ('$set' in modifier && Object.keys(modifier).length == 1) {
      const setMap = modifier['$set'] as Record<string,EJSONable>;
      if (Object.keys(setMap).some(x => x.includes('.'))) throw new Error(`TODO: no deep keys yet`);
      let numberAffected = 0;
      for (const {_id, ...fields} of new Cursor(this.find(selector))) {
        this.liveColl.changeDocument(_id, {
          ...fields,
          ...setMap,
        }, []);
        numberAffected++;
        if (!options?.multi) break;
      }
      return numberAffected;
    }
    throw new Error("TODO: Method 'update' not implemented.");
  }

  upsert(_selector: Record<string, unknown>, _modifier: Record<string, unknown>, _options?: UpsertOpts): UpsertResult {
    throw new Error("TODO: Method 'upsert' not implemented.");
  }

  remove(selector: Record<string, unknown>): number {
    let numberAffected = 0;
    for (const doc of new Cursor(this.find(selector))) {
      this.liveColl.removeDocument(doc._id);
      numberAffected++;
    }
    return numberAffected;
  }
}
