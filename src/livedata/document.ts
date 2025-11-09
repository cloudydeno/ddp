import type { DocumentFields, FieldValue, FindOpts, HasId } from "./types.ts";

/** @TODO replace impl with npm:sift */
export function checkMatch(selector: Record<string,unknown>, docId: string, docFields: DocumentFields): boolean {
  for (const [field, spec] of Object.entries(selector)) {
    if (field.startsWith('$')) throw new Error(`TODO: selectors 1`);
    // console.log({spec, selector})
    if (Object.keys(spec as {_:1}).some(x => x.startsWith('$'))) throw new Error(`TODO: selectors 2`);
    if (field == '_id') {
      if (spec !== docId) return false;
      continue;
    }
    let fieldValue: FieldValue = null;
    if (field.includes('.')) {
      // throw new Error(`TODO: paths! ${field}`);
      fieldValue = docFields;
      for (const part of field.split('.')) {
        fieldValue = ((fieldValue as Record<string,FieldValue>)[part] as Record<string,FieldValue>) ?? {};
      }
    } else {
      fieldValue = docFields[field];
    }
    if (typeof spec == 'string' || typeof spec == 'number') {
      if (spec !== fieldValue) return false;
      continue;
    }
    throw new Error(`TODO: selectors! (using sift)`);
  }
  return true;
}

/** Clones a document using the 'fields' subset. */
export function makeReturnDoc<T extends HasId>(_id: string, original: T, opts: FindOpts): T {
  // const cloned = EJSON.clone(original);

  const fieldsSpec = (opts?.fields ?? {}) as Record<keyof T, boolean|0|1|undefined>;
  const subset: Partial<T> = {};
  let includeOthers = true;
  for (const pair of Object.entries(fieldsSpec)) {
    if (pair[1] === true || pair[1] === 1) {
      includeOthers = false;
      if (pair[0] == '_id') {
        subset['_id'] = _id;
      } else if (pair[0] in original) {
        subset[pair[0] as keyof T] = structuredClone(original[pair[0] as keyof T]);
      }
    }
  }
  if (includeOthers) {
    for (const pair of Object.entries<unknown>(original)) {
      if (pair[0] in fieldsSpec) continue;
      subset[pair[0] as keyof T] = structuredClone(pair[1]) as T[keyof T];
    }
    if (!('_id' in fieldsSpec)) {
      subset['_id'] = _id;
    }
  }
  return subset as T; // TODO: this is a lie once fields is supplied
}
