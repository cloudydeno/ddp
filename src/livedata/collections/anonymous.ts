import { EJSON, type EJSONable } from "@cloudydeno/ejson";

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

    let numberAffected = 0;
    for (const original of new Cursor(this.find(selector))) {
      let isAffected = false;
      let mutable = structuredClone(original) as EJSONable;

      for (const [opName, opArg] of Object.entries(modifier)) {
        switch (opName) {

          case '$set': {
            const setMap = opArg as Record<string,EJSONable>;
            if (Object.keys(setMap).some(x => x.includes('.'))) throw new Error(`TODO: no deep keys yet`);
            mutable = {...mutable, ...setMap};
            isAffected = true;
          } break;

          // https://www.mongodb.com/docs/manual/reference/operator/update/addToSet/
          case '$addToSet': {
            const fieldMap = opArg as Record<string,EJSONable>;
            for (const [field, value] of Object.entries(fieldMap)) {
              if (Object.keys(value ?? {}).some(x => x[0] == '$')) throw new Error(`TODO embedded operators`);
              let docPiece = mutable;
              const fieldLabels = field.split('.');
              const listLabel = fieldLabels.pop();
              if (!listLabel) throw new Error(`no labels in addToSet somehow`);
              for (const label of fieldLabels) {
                const piece = docPiece[label] ??= {};
                if (typeof piece !== 'object') throw new Error(`expected object at "${label}"`);
                docPiece = piece as EJSONable;
              }
              // if (field.includes('.')) throw new Error(`TODO: no deep keys yet: ${field}`);
              const existingValue = docPiece[listLabel] ??= [];
              if (!Array.isArray(existingValue)) throw new Error(`addToSet to non-array`);
              if (!existingValue.includes(value)) {
                existingValue.push(value);
                isAffected = true;
              }
            }
          } break;

          // https://www.mongodb.com/docs/manual/reference/operator/update/addToSet/
          case '$push': {
            const fieldMap = opArg as Record<string,EJSONable>;
            for (const [field, value] of Object.entries(fieldMap)) {
              if (Object.keys(value ?? {}).some(x => x[0] == '$')) throw new Error(`TODO embedded operators`);
              let docPiece = mutable;
              const fieldLabels = field.split('.');
              const listLabel = fieldLabels.pop();
              if (!listLabel) throw new Error(`no labels in push somehow`);
              for (const label of fieldLabels) {
                const piece = docPiece[label] ??= {};
                if (typeof piece !== 'object') throw new Error(`expected object at "${label}"`);
                docPiece = piece as EJSONable;
              }
              // if (field.includes('.')) throw new Error(`TODO: no deep keys yet: ${field}`);
              const existingValue = docPiece[listLabel] ??= [];
              if (!Array.isArray(existingValue)) throw new Error(`push to non-array`);
              existingValue.push(value);
              isAffected = true;
            }
          } break;

          default:
            throw new Error(`TODO: Unimplemented update operator "${opName}"`);
        }
      }

      if (isAffected) {
        const {_id, ...fields} = mutable as T;
        const keysBefore = new Set(Object.keys(original));
        const keysAfter = new Set(Object.keys(mutable));
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
