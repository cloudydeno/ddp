import { EJSON } from "@cloudydeno/ejson";
import type { DocumentChange, DocumentFields, ServerSentPacket } from "lib/types.ts";

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

  private _isSending: boolean = true;

  private considerSending(packet: DocumentChange) {
    if (this._isSending) {
      this.connection.send([{
        ...packet,
        collection: this.collection,
      }]);
    }
  }

  private beforeView: Map<string, PresentedDocument> = new Map;
  startRerun() {
    this._isSending = false;
    this.beforeView = this.documentCache;
    this.documentCache = new Map;
  }
  flushRerun() {
    this._isSending = true;
    diffMaps(this.beforeView, this.documentCache, {
      both: (docId, leftValue, rightValue) => {
        const beforeFields = new Map(Object.entries(leftValue.clientView));
        const afterFields = Object.entries(rightValue.clientView);
        const changed = afterFields.filter(([fieldKey, afterValue]) => {
          const beforeValue = beforeFields.get(fieldKey);
          if (beforeValue === undefined) return true;
          return EJSON.equals(beforeValue as EJSON, afterValue as EJSON);
        });
        const removed = new Set(beforeFields.keys())
          .difference(new Set(Object.keys(afterFields)));
        if (changed.length || removed.size) {
          this.considerSending({
            msg: 'changed',
            id: docId,
            fields: Object.fromEntries(changed),
            cleared: removed.size ? [...removed] : undefined,
          });
        }
      },
      rightOnly: (docId, rightValue) => {
        this.considerSending({
          msg: 'added',
          id: docId,
          fields: rightValue.clientView,
        });
      },
      leftOnly: (docId) => {
        this.considerSending({
          msg: 'removed',
          id: docId,
        });
      },
    });
    this.beforeView = new Map;
  }

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
        this.considerSending({
          msg: 'changed',
          id: docId,
          fields: fields,
        });
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
      this.considerSending({
        msg: 'added',
        id: docId,
        fields: fields,
      });
    }
  }

  changed(subId: string, docId: string, fields: DocumentFields): void {
    const doc = this.documentCache.get(docId);
    if (!doc) throw new Error(`BUG: got changed for unknown doc`);
    const existingFields = doc.presentedFields.get(subId);
    if (!existingFields) throw new Error(`BUG: got changed for unpresented doc`);

    if (Object.entries(fields).length == 0) return;

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

    this.considerSending({
      msg: 'changed',
      id: docId,
      fields: fields,
      cleared: cleared.length ? cleared : undefined,
    });
  }

  removed(subId: string, docId: string): void {
    const doc = this.documentCache.get(docId);
    if (!doc) throw new Error(`BUG: got removed for unknown doc`);
    const existingFields = doc.presentedFields.get(subId);
    if (!existingFields) throw new Error(`BUG: got removed for unpresented doc`);

    doc.presentedFields.delete(subId);
    if (doc.presentedFields.size == 0) {
      this.considerSending({
        msg: 'removed',
        id: docId,
      });
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
      this.considerSending({
        msg: 'changed',
        id: docId,
        cleared: removed,
      });
    }
  }
}


function diffMaps<Tval>(left: Map<string, Tval>, right: Map<string, Tval>, callbacks: {
  both: (id: string, leftValue: Tval, rightValue: Tval) => void;
  leftOnly: (id: string, leftValue: Tval) => void;
  rightOnly: (id: string, rightvalue: Tval) => void;
}) {
  for (const [key, leftValue] of left) {
    if (right.has(key)) {
      callbacks.both(key, leftValue, right.get(key)!);
    } else {
      callbacks.leftOnly(key, leftValue);
    }
  }

  for (const [key, rightValue] of right) {
    if (!left.has(key)) {
      callbacks.rightOnly(key, rightValue);
    }
  }
};
