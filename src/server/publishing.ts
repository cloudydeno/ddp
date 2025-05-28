import type { DocumentFields, ServerSentPacket } from "../lib/types.ts";

export interface PresentedDocument {
  // collection: string;
  // id: string;
  presentedFields: Map<string, DocumentFields>;
  clientView: DocumentFields;
}

// TODO: UNIT TESTS
// TODO: UNIT TESTS
// TODO: UNIT TESTS
export class PresentedCollection {
  constructor(
    private readonly connection: {
      send(pkts: ServerSentPacket[]): void;
    },
    private readonly collection: string
  ) { }
  private documentCache = new Map<string, PresentedDocument>();

  dropSub(subId: string) {
    for (const [docId, doc] of this.documentCache) {
      if (doc.presentedFields.has(subId)) {
        this.removed(subId, docId);
      }
    }
  }

  added(subId: string, docId: string, fields: DocumentFields): void {
    const doc = this.documentCache.get(docId);
    if (doc) {
      const existingFields = doc.presentedFields.get(subId);
      if (existingFields) {
        throw new Error(`TODO: given 'added' for document that was already added`);
      } else {
        doc.presentedFields.set(subId, { ...fields });
        this.connection.send([{
          msg: 'changed',
          collection: this.collection,
          id: docId,
          fields: fields,
        }]);
        for (const [key, val] of Object.entries(fields)) {
          doc.clientView[key] = val;
        }
      }
    } else {
      this.documentCache.set(docId, {
        presentedFields: new Map([
          [subId, { ...fields }],
        ]),
        clientView: { ...fields },
      });
      this.connection.send([{
        msg: 'added',
        collection: this.collection,
        id: docId,
        fields: fields,
      }]);
    }
  }

  changed(subId: string, docId: string, fields: DocumentFields): void {
    const doc = this.documentCache.get(docId);
    if (!doc) throw new Error(`BUG: got changed for unknown doc`);
    const existingFields = doc.presentedFields.get(subId);
    if (!existingFields) throw new Error(`BUG: got changed for unpresented doc`);

    const cleared = new Array<string>;
    for (const [key, val] of Object.entries(fields)) {
      if (val === undefined) {
        delete doc.clientView[key];
        cleared.push(key);
      } else {
        existingFields[key] = val;
        doc.clientView[key] = val;
      }
    }

    this.connection.send([{
      msg: 'changed',
      collection: this.collection,
      id: docId,
      fields: fields,
      cleared: cleared.length ? cleared : undefined,
    }]);
  }

  removed(subId: string, docId: string): void {
    const doc = this.documentCache.get(docId);
    if (!doc) throw new Error(`BUG: got removed for unknown doc`);
    const existingFields = doc.presentedFields.get(subId);
    if (!existingFields) throw new Error(`BUG: got removed for unpresented doc`);

    doc.presentedFields.delete(subId);
    if (doc.presentedFields.size == 0) {
      this.connection.send([{
        msg: 'removed',
        collection: this.collection,
        id: docId,
      }]);
      this.documentCache.delete(docId);
      return;
    }

    // reconsile what was removed
    const remainingKeys = new Set<string>();
    for (const presented of doc.presentedFields.values()) {
      for (const key of Object.keys(presented)) {
        remainingKeys.add(key);
      }
    }
    const removed = new Array<string>;
    for (const key of Object.keys(existingFields)) {
      if (remainingKeys.has(key)) {
        continue;
      }
      removed.push(key);
      delete doc.clientView[key];
    }
    if (removed.length > 0) {
      this.connection.send([{
        msg: 'changed',
        collection: this.collection,
        id: docId,
        cleared: removed,
      }]);
    }
  }
}
