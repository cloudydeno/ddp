import type { HasId, PartialCollectionApi, AsyncCollection, UpdateOpts, UpsertOpts, UpsertResult } from "../types.ts";
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

  getApi<T extends HasId>(): PartialCollectionApi<T> {
    return new RemoteCollectionApi<T>(this);
  }
}

export class RemoteCollectionApi<T extends HasId> extends LiveCollectionApi<T> implements AsyncCollection<T> {
  constructor(private readonly remoteColl: RemoteCollection) {
    super(remoteColl);
  }
  get collectionName(): string | null {
    return this.remoteColl.name;
  }
  async insertAsync(doc: T): Promise<string> {
    // TODO: ensure randomSeed is sent if an ID was generated
    const resp = await this.remoteColl.client.callMethod(`/${this.remoteColl.name}/insert`, [doc]);
    if (typeof resp !== 'string') throw new Error(`TODO: insert resp is not a string?`);
    return resp;
  }
  updateAsync(selector: Record<string, unknown>, modifier: Record<string, unknown>, options?: UpdateOpts): Promise<number> {
    throw new Error("TODO: Method 'updateAsync' not implemented.");
  }
  upsertAsync(selector: Record<string, unknown>, modifier: Record<string, unknown>, options?: UpsertOpts): Promise<UpsertResult> {
    throw new Error("TODO: Method 'upsertAsync' not implemented.");
  }
  async removeAsync(selector: Record<string, unknown>): Promise<number> {
    const resp = await this.remoteColl.client.callMethod(`/${this.remoteColl.name}/remove`, [selector]);
    if (typeof resp !== 'number') throw new Error(`TODO: remove resp is not a number?`);
    return resp;
  }
}
