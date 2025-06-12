import { EJSON, type EJSONable } from "@cloudydeno/ejson";

import type { HasId } from "../types.ts";
import { LiveCollection, LiveCollectionApi } from "./live.ts";

export class AnonymousCollection extends LiveCollection {
  getApi() {
    return new AnonymousCollectionApi(this);
  }
}

export class AnonymousCollectionApi<T extends HasId> extends LiveCollectionApi<T> {
  // constructor(private readonly anonColl: AnonymousCollection) {
  //   super(anonColl);
  // }

  insert({_id, ...fields}: T) {
    if (!_id) throw new Error(`_id is required`);
    this.liveColl.addDocument(_id, EJSON.clone(fields as EJSONable));
  }
  // TODO: more
}
