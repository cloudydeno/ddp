import { assertEquals } from "jsr:@std/assert@1.0.13/equals";
import { AnonymousCollection } from "./anonymous.ts";

Deno.test('AnonymousCollection inserts', () => {
  const coll = new AnonymousCollection();
  const api = coll.getApi();

  assertEquals(api.find().count(), 0);
  api.insert({_id: 'one'});
  assertEquals(api.find().count(), 1);
  api.insert({_id: 'two'});
  assertEquals(api.find().count(), 2);
  // TODO:
  // api.remove({_id: 'two'});
  // assertEquals(api.find().count(), 1);
})
