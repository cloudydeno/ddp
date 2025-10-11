import type { HasId, PartialCollectionApi } from "../types.ts";
import { LiveCollection, LiveCollectionApi } from "./live.ts";
import type { DdpConnection } from "../../client/connection.ts";
// import type { EJSONableProperty } from "@cloudydeno/ejson";

export class RemoteCollection extends LiveCollection {
  constructor(
    public readonly client: DdpConnection,
    public readonly name: string,
  ) {
    super();
    // TODO: register simulations of the update methods into the client
  }

  getApi<T extends HasId>(): RemoteCollectionApi<T> {
    return new RemoteCollectionApi<T>(this);
  }
}

export class RemoteCollectionApi<T extends HasId> extends LiveCollectionApi<T> implements PartialCollectionApi<T> {
  constructor(private readonly remoteColl: RemoteCollection) {
    super(remoteColl);
  }

  async insertAsync(doc: T): Promise<string> {
    // TODO: ensure randomSeed is sent if an ID was generated
    const resp = await this.remoteColl.client.callMethod(`/${this.remoteColl.name}/insert`, [doc]);
    if (typeof resp !== 'string') throw new Error(`TODO: resp is not a string?`);
    return resp;
  }
  // TODO: more
}
