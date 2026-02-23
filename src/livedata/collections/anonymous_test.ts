import { assertEquals } from "@std/assert/equals";
import { AnonymousCollection } from "./anonymous.ts";
import { Collection } from "../facades.ts";
import { assertObjectMatch } from "@std/assert/object-match";

Deno.test('AnonymousCollection inserts', () => {
  const coll = new AnonymousCollection(null);
  const api = new Collection(coll.getApi());

  assertEquals(api.find().count(), 0);
  api.insert({ _id: 'one' });
  assertEquals(api.find().count(), 1);
  api.insert({ _id: 'two' });
  assertEquals(api.find().count(), 2);
})

Deno.test('AnonymousCollection removes', () => {
  const coll = new AnonymousCollection(null);
  const api = new Collection(coll.getApi<{
    _id: string;
    hello: string;
  }>());

  coll.addDocument('one',   { hello: 'world' });
  coll.addDocument('two',   { hello: 'there' });
  coll.addDocument('three', { hello: 'world' });

  assertEquals(api.find().count(), 3);
  api.remove({ hello: 'world' });
  assertEquals(api.find().count(), 1);
  api.remove({ _id: 'two' });
  assertEquals(api.find().count(), 0);
})

Deno.test('AnonymousCollection updates', () => {
  const coll = new AnonymousCollection(null);
  const api = new Collection(coll.getApi<{
    _id: string;
    hello: string;
  }>());

  coll.addDocument('one', { hello: 'world' });

  assertObjectMatch(api.findOne() ?? {}, { _id: 'one', hello: 'world' });
  api.update({ hello: 'world' }, { $set: { hello: 'there' } });
  assertObjectMatch(api.findOne() ?? {}, { _id: 'one', hello: 'there' });
  api.update({   _id: 'one'   }, { $set: { hello: 'world' } });
  assertObjectMatch(api.findOne() ?? {}, { _id: 'one', hello: 'world' });
})
