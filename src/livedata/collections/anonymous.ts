import { EJSON, type EJSONable } from "@cloudydeno/ejson";

import type { HasId, PartialCollectionApi } from "../types.ts";
import { LiveCollection, LiveCollectionApi } from "./live.ts";

export class AnonymousCollection extends LiveCollection {
  getApi<T extends HasId>(): AnonymousCollectionApi<T> {
    return new AnonymousCollectionApi<T>(this);
  }
}

export class AnonymousCollectionApi<T extends HasId> extends LiveCollectionApi<T> implements PartialCollectionApi<T> {
  // constructor(private readonly anonColl: AnonymousCollection) {
  //   super(anonColl);
  // }

  insert({_id, ...fields}: T): string {
    if (!_id) throw new Error(`_id is required`); // TODO: is it?
    this.liveColl.addDocument(_id, EJSON.clone(fields as EJSONable));
    return _id;
  }
  // TODO: more
}
