import type { HasId } from "../types.ts";
import { LiveCollection, LiveCollectionApi } from "./live.ts";
import type { DdpConnection } from "../../client/connection.ts";
import type { EJSONableProperty } from "@cloudydeno/ejson";

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

export class RemoteCollectionApi<T extends HasId> extends LiveCollectionApi<T> {
  constructor(private readonly remoteColl: RemoteCollection) {
    super(remoteColl);
  }

  async insert(doc: T): Promise<EJSONableProperty> {
    // TODO: ensure randomSeed is sent if an ID was generated
    return await this.remoteColl.client.callMethod(`/${this.remoteColl.name}/insert`, [doc]);
  }
  // TODO: more
}
