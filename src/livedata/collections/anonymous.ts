import { EJSON, type EJSONableProperty, type EJSONable } from "@cloudydeno/ejson";
// import { updateToPredicate } from "jsonmongoquery";
import sift from "sift";

import type { SyncCollection, HasId, UpdateOpts, UpsertOpts, UpsertResult, DocumentFields } from "../types.ts";
import { LiveCollection, LiveCollectionApi } from "./live.ts";
import { Cursor } from "../facades.ts";
import { Random } from "lib/random.ts";

export class AnonymousCollection extends LiveCollection {
  constructor(
    public readonly collectionName: string | null,
  ) {
    super();
  }

  getApi<T extends HasId>(): AnonymousCollectionApi<T> {
    return new AnonymousCollectionApi<T>(this, this.collectionName);
  }
}

export class AnonymousCollectionApi<T extends HasId> extends LiveCollectionApi<T> implements SyncCollection<T> {
  constructor(
    liveColl: AnonymousCollection,
    public readonly collectionName: string | null,
  ) {
    super(liveColl);
    // TODO: register simulations of the update methods into the client
  }

  protected makeNewId(): string {
    return new Random().id();
  }

  insert(doc: T): string {
    let {_id, ...fields} = doc;
    _id ??= this.makeNewId();
    if (typeof _id != 'string') throw new Error(`Only string IDs are accepted`);
    this.liveColl.addDocument(_id, EJSON.clone(fields as EJSONable));
    return _id;
  }

  update(selector: Record<string, unknown>, modifier: Record<string, unknown>, options?: UpdateOpts): number {
    const keys = Object.keys(modifier);
    const allOps = keys.every(x => x[0] == '$');
    const someOps = keys.some(x => x[0] == '$');
    if (someOps && !allOps) throw new Error(`Mixture of update ops and fields`);
    if (!someOps) throw new Error(`TODO: update with only fields`);

    console.log('Running update modifier', modifier);
    const updateFunc = updateToPredicate(modifier) as (doc: EJSONable) => boolean;

    let numberAffected = 0;
    for (const original of new Cursor(this.find(selector))) {
      const mutable = structuredClone(original) as EJSONable;
      // console.log([mutable['$addToSet']?.['services.resume.loginTokens'], Object.prototype.toString.call(mutable['$addToSet']?.['services.resume.loginTokens'])])
      if (updateFunc(mutable)) {
        const {_id, ...fields} = mutable as T;
        const keysBefore = new Set(Object.keys(original));
        const keysAfter = new Set(Object.keys(mutable));
        if (_id !== original._id) {
          throw new Error(`Performing an update on the immutable field '_id' is not allowed`);
        }
        this.liveColl.changeDocument(_id, fields as DocumentFields, [...keysBefore.difference(keysAfter)]);
        numberAffected++;
      }
      if (!options?.multi) break;
    }
    return numberAffected;
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


function updateToPredicate(modifier: Record<string,unknown>): (mutable: EJSONable) => boolean {
  return (mutable) => {
    let isAffected = false;

    function getAtNestedKey<Tval>(key: string): Tval | undefined {
      const parts = key.split('.');
      const lastPart = parts.pop()!;
      let ref: EJSONable = mutable;
      for (const part of parts) {
        ref = ref[part] as EJSONable;
        if (!ref) return undefined;
        if (typeof ref !== 'object') throw new Error(`expected object at "${part}"`);
      }
      return ref[lastPart] as Tval;
    }
    function setAtNestedKey<Tval>(key: string, newVal: Tval | undefined): void {
      if (Object.keys(newVal ?? {}).some(x => x[0] == '$')) throw new Error(`TODO embedded operators`);
      const parts = key.split('.');
      const lastPart = parts.pop();
      if (!lastPart) throw new Error(`no labels in addTosetAtNestedKeySet somehow`);
      let ref: EJSONable = mutable;
      for (const part of parts) {
        ref[part] ??= {};
        ref = ref[part] as EJSONable;
        if (typeof ref !== 'object') throw new Error(`expected object at "${part}"`);
      }
      ref[lastPart] = newVal as EJSONableProperty;
    }

    for (const [opName, opArg] of Object.entries(modifier)) {
      switch (opName) {

        case '$set': {
          const setMap = opArg as Record<string,EJSONable>;
          for (const field of Object.entries(setMap)) {
            setAtNestedKey(field[0], field[1]);
            isAffected = true;
          }
        } break;

        case '$inc': {
          const fieldMap = opArg as Record<string,EJSONable>;
          if (Object.keys(fieldMap).some(x => x.includes('.'))) throw new Error(`TODO: no deep keys yet`);
          for (const field of Object.entries(fieldMap)) {
            const existVal = getAtNestedKey<number>(field[0]);
            if (typeof existVal != 'number') throw new Error(`Can't $inc on ${typeof existVal} value`);
            if (typeof field[1] != 'number') throw new Error(`Can't $inc with ${typeof field[1]} value`);
            setAtNestedKey(field[0], existVal + field[1]);
            isAffected = true;
          }
        } break;

        // https://www.mongodb.com/docs/manual/reference/operator/update/addToSet/
        case '$addToSet': {
          const fieldMap = opArg as Record<string,EJSONable>;
          for (const [field, value] of Object.entries(fieldMap)) {
            if (Object.keys(value ?? {}).some(x => x[0] == '$')) throw new Error(`TODO embedded operators`);
            let list = getAtNestedKey<Array<unknown>>(field);
            if (!list) {
              setAtNestedKey(field, list = []);
            }
            if (!Array.isArray(list)) throw new Error(`addToSet to non-array`);
            if (!list.some(item => EJSON.equals(item as EJSON, value))) {
              list.push(value);
              isAffected = true;
            }
          }
        } break;

        // https://www.mongodb.com/docs/manual/reference/operator/update/addToSet/
        case '$push': {
          const fieldMap = opArg as Record<string,EJSONable>;
          for (const [field, value] of Object.entries(fieldMap)) {
            if (Object.keys(value ?? {}).some(x => x[0] == '$')) throw new Error(`TODO embedded operators`);
            let list = getAtNestedKey<Array<unknown>>(field);
            if (!list) {
              setAtNestedKey(field, list = []);
            }
            if (!Array.isArray(list)) throw new Error(`push to non-array`);
            list.push(value);
            isAffected = true;
          }
        } break;

        // https://www.mongodb.com/docs/manual/reference/operator/update/addToSet/
        case '$pull': {
          const fieldMap = opArg as Record<string,EJSONable>;
          for (const [field, value] of Object.entries(fieldMap)) {
            if (Object.keys(value).length == 0) continue;
            const condition = (Object.keys(value ?? {}).some(x => x[0] == '$'))
              ? sift.default(value)
              : (item: unknown) => !EJSON.equals(item as EJSON, value);
            const list = getAtNestedKey<Array<unknown>>(field) ?? [];
            if (!Array.isArray(list)) throw new Error(`pull to non-array`);
            const filtered = list.filter(item => !condition(item));
            if (filtered.length != list.length) {
              setAtNestedKey(field, filtered)
              isAffected = true;
            }
          }
        } break;

        default:
          throw new Error(`TODO: Unimplemented update operator "${opName}"`);
      }
    }
    return isAffected;
  };
}
