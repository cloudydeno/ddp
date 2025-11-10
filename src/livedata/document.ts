import type { FindOpts, HasId } from "./types.ts";

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
