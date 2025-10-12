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
    const resp = await this.remoteColl.client.callMethod(`/${this.remoteColl.name}/insert`, [doc]);
    if (typeof resp !== 'string') throw new Error(`TODO: insert resp is not a string?`);
    return resp;
  }
  async updateAsync(selector: Record<string, unknown>, modifier: Record<string, unknown>, options?: UpdateOpts): Promise<number> {
    const resp = await this.remoteColl.client.callMethod(`/${this.remoteColl.name}/update`, [selector, modifier, options]);
    if (typeof resp !== 'number') throw new Error(`TODO: update resp is not a number?`);
    return resp;
  }
  async upsertAsync(selector: Record<string, unknown>, modifier: Record<string, unknown>, options?: UpsertOpts): Promise<UpsertResult> {
    const resp = await this.remoteColl.client.callMethod(`/${this.remoteColl.name}/upsert`, [selector, modifier, options]);
    if (typeof resp !== 'object') throw new Error(`TODO: upsert resp is not a number?`);
    return resp as UpsertResult;
  }
  async removeAsync(selector: Record<string, unknown>): Promise<number> {
    const resp = await this.remoteColl.client.callMethod(`/${this.remoteColl.name}/remove`, [selector]);
    if (typeof resp !== 'number') throw new Error(`TODO: remove resp is not a number?`);
    return resp;
  }
}
