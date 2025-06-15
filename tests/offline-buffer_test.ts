import { assert } from 'jsr:@std/assert@1.0.13/assert';
import { assertEquals } from 'jsr:@std/assert@1.0.13/equals';
import { assertObjectMatch } from 'jsr:@std/assert@1.0.13/object-match';

import { DdpInterface } from '../src/server/interface.ts';
import { setupClientFor } from "./util.ts";

Deno.test('offline buffer methods', {
  permissions: 'none',
}, async () => {

  const serverIface = new DdpInterface();
  serverIface.addMethod('emoji', async () => {
    await new Promise(ok => setTimeout(ok, 1));
    return '👍';
  });

  using session = setupClientFor(serverIface, {
    autoConnect: false,
  });

  const methodPromise = session.client.callMethod('emoji', []);
  session.client.connect();
  const emojiResp = await methodPromise;

  assertEquals(emojiResp, '👍');
});

Deno.test('offline subscriptions', {
  permissions: 'none',
}, async () => {

  const serverIface = new DdpInterface();
  serverIface.addPublication('climate/all', sub => {
    sub.added('climate', 'indoor', { celcius: 21 });
    sub.added('climate', 'outdoor', { celcius: 25 });
    sub.ready();
  });

  using session = setupClientFor(serverIface, {
    autoConnect: false,
  });

  const collection = session.client.getCollection('climate');
  assertEquals(await collection.find().countAsync(), 0);

  const sub = session.client.subscribe('climate/all');
  assertEquals(await collection.find().countAsync(), 0);

  session.client.connect();

  await sub.ready;
  assertEquals(await collection.find().countAsync(), 2);
});
