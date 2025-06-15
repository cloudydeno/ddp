import { assert } from 'jsr:@std/assert@1.0.13/assert';
import { assertEquals } from 'jsr:@std/assert@1.0.13/equals';
import { assertObjectMatch } from 'jsr:@std/assert@1.0.13/object-match';

import { DdpInterface } from '../src/server/interface.ts';
import { setupClientFor } from "./util.ts";

Deno.test('basic method', {
  permissions: 'none',
}, async () => {

  const serverIface = new DdpInterface();
  serverIface.addMethod('emoji', async () => {
    await new Promise(ok => setTimeout(ok, 1));
    return '👍';
  });

  using session = setupClientFor(serverIface);
  await session.ping();

  const emojiResp = await session.client.callMethod('emoji', []);
  assertEquals(emojiResp, '👍');
});

Deno.test('basic subscribe', {
  permissions: 'none',
}, async () => {

  const serverIface = new DdpInterface();
  serverIface.addPublication('increments', (sub, [arg0]) => {
    const count = typeof arg0 == 'number' ? arg0 : 5;
    for (let i = 1; i <= count; i++) {
      sub.added('sequence', `${i}`, { number: i, hex: i.toString(16) });
    }
    sub.ready();
  });

  using session = setupClientFor(serverIface);
  await session.ping();

  const sub = session.client.subscribe('increments', [16]);
  await sub.ready;

  const collection = session.client.getCollection('sequence');
  const items = await collection.find().fetchAsync();

  assertEquals(items.length, 16);
  assertObjectMatch(items[0], { number: 1, hex: "1", _id: "1" });
  assertObjectMatch(items[14], { number: 15, hex: "f", _id: "15" });
});

Deno.test('universal publish', {
  permissions: 'none',
}, async () => {

  const serverIface = new DdpInterface();
  serverIface.addDefaultPublication('server-identity', (sub) => {
    sub.added('server-identity', `main`, { name: 'e2e tests' });
    sub.ready();
  });

  using session = setupClientFor(serverIface);
  await session.ping();

  const collection = session.client.getCollection('server-identity');
  await session.client.ping();
  const item = collection.findOne({ _id: 'main' });
  assert(item);
  assertObjectMatch(item, { name: 'e2e tests' });
});
