import { assertEquals } from 'jsr:@std/assert@1.0.13/equals';
import { assertObjectMatch } from 'jsr:@std/assert@1.0.13/object-match';

import { DdpInterface, DdpStreamSession } from '../src/server/mod.ts';
import { DDPClient } from '../src/client/mod.ts';

Deno.test('basic method', {
  permissions: 'none',
}, async () => {

  const serverIface = new DdpInterface();
  serverIface.addMethod('emoji', async () => {
    await new Promise(ok => setTimeout(ok, 1));
    return '👍';
  })

  const clientToServer = new TransformStream<string>();
  const serverToClient = new TransformStream<string>();

  using server = new DdpStreamSession(serverIface, clientToServer.readable, serverToClient.writable);
  const client = new DDPClient(null, serverToClient.readable, clientToServer.writable, 'raw');
  await client.runHandshake();
  client.runInboundLoop();

  const emojiResp = await client.callMethod('emoji', []);
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
  })

  const clientToServer = new TransformStream<string>();
  const serverToClient = new TransformStream<string>();

  using server = new DdpStreamSession(serverIface, clientToServer.readable, serverToClient.writable);
  const client = new DDPClient(null, serverToClient.readable, clientToServer.writable, 'raw');
  await client.runHandshake();
  client.runInboundLoop();

  const sub = client.subscribe('increments', [5]);
  await sub.ready;
  const collection = client.getCollection('sequence');
  const items = await collection.find().fetchAsync();

  assertEquals(items.length, 5);
  assertObjectMatch(items[0], { number: 1, hex: "1", _id: "1" });
});
