import { assertEquals } from '@std/assert/equals';

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

  using client = setupClientFor(serverIface, {
    autoConnect: false,
  });

  const methodPromise = client.callMethod('emoji', []);
  client.connect();
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

  using client = setupClientFor(serverIface, {
    autoConnect: false,
  });

  const collection = client.getCollection('climate');
  assertEquals(await collection.find().countAsync(), 0);

  const sub = client.subscribe('climate/all');
  assertEquals(await collection.find().countAsync(), 0);

  client.connect();

  await sub.liveReady.waitForValue(true);
  assertEquals(await collection.find().countAsync(), 2);
});
