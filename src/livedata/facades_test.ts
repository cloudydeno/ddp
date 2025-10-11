import { assertRejects } from "@std/assert/rejects";
import { assertObjectMatch } from "@std/assert/object-match";
import { assertEquals } from "@std/assert/equals";

import type { HasId } from "@cloudydeno/ddp/livedata/types.ts";
import { Collection } from "./facades.ts";

interface TestDoc extends HasId {
  name: string;
}

Deno.test('empty facade', async () => {
  const coll = new Collection<TestDoc>({
    find() {
      return {};
    },
  });

  await assertRejects(() => Promise.try(() => coll.findOne()), 'not implemented');
  await assertRejects(() => coll.findOneAsync(), 'not implemented');

  const cursor = coll.find();
  await assertRejects(() => Promise.try(() => cursor.count()), 'not implemented');
  await assertRejects(() => Promise.try(() => cursor.countAsync()), 'not implemented');
});

Deno.test('basic async facade', async () => {
  const coll = new Collection<TestDoc>({
    find() {
      return {
        [Symbol.asyncIterator]() {
          return ReadableStream.from([{ _id: 'test', name: 'test' }])[Symbol.asyncIterator]();
        },
      };
    },
  });

  await assertRejects(() => Promise.try(() => coll.findOne()), 'not implemented');
  assertObjectMatch(await coll.findOneAsync() ?? {}, { _id: 'test'});

  const cursor = coll.find();
  await assertRejects(() => Promise.try(() => cursor.count()), 'not implemented');
  assertEquals(await cursor.countAsync(), 1);
});

Deno.test('basic sync facade', async () => {
  const coll = new Collection<TestDoc>({
    find() {
      return {
        [Symbol.iterator]() {
          return [{ _id: 'test', name: 'test' }][Symbol.iterator]();
        },
      };
    },
  });

  assertObjectMatch(coll.findOne() ?? {}, { _id: 'test'});
  assertObjectMatch(await coll.findOneAsync() ?? {}, { _id: 'test'});

  const cursor = coll.find();
  assertEquals(cursor.count(), 1);
  assertEquals(await cursor.countAsync(), 1);

  assertEquals(cursor.fetch().length, 1);
  assertEquals((await cursor.fetchAsync()).length, 1);

  assertEquals(cursor.map(x => x._id)[0], 'test');
  assertEquals((await cursor.mapAsync(x => x._id))[0], 'test');
});
