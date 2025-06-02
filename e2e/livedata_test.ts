import { assert } from 'jsr:@std/assert@1.0.13/assert';
import { assertEquals } from 'jsr:@std/assert@1.0.13/equals';
import { assertObjectMatch } from 'jsr:@std/assert@1.0.13/object-match';

import { DDPClient } from '../src/client/mod.ts';

import { DdpInterface } from '../src/server/interface.ts';
import { DdpStreamSession } from "../src/server/session.ts";
import { ServerSentSubscriptionPacket } from "lib/types.ts";

async function setupClientFor(serverIface: DdpInterface) {

  const clientToServer = new TransformStream<string>();
  const serverToClient = new TransformStream<string>();

  const server = new DdpStreamSession(serverIface, clientToServer.readable, serverToClient.writable);

  const client = new DDPClient(null, serverToClient.readable, clientToServer.writable, 'raw');
  await client.runHandshake();
  client.runInboundLoop();

  return {
    client,
    server,
    [Symbol.dispose]: () => server.close(),
  };
}

Deno.test('basic method', {
  permissions: 'none',
}, async () => {

  const serverIface = new DdpInterface();
  serverIface.addMethod('emoji', async () => {
    await new Promise(ok => setTimeout(ok, 1));
    return '👍';
  });

  using session = await setupClientFor(serverIface);
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

  using session = await setupClientFor(serverIface);

  const sub = session.client.subscribe('increments', [5]);
  await sub.ready;

  const collection = session.client.getCollection('sequence');
  const items = await collection.find().fetchAsync();

  assertEquals(items.length, 5);
  assertObjectMatch(items[0], { number: 1, hex: "1", _id: "1" });
});

Deno.test('universal publish', {
  permissions: 'none',
}, async () => {

  const serverIface = new DdpInterface();
  serverIface.addDefaultPublication('server-identity', (sub) => {
    sub.added('server-identity', `main`, { name: 'e2e tests' });
    sub.ready();
  });

  using session = await setupClientFor(serverIface);

  const collection = session.client.getCollection('server-identity');
  await session.client.ping();
  const item = collection.findOne({ _id: 'main' });
  assert(item);
  assertObjectMatch(item, { name: 'e2e tests' });
});

Deno.test('cursor subscribe', {
  permissions: 'none',
}, async () => {

  const serverIface = new DdpInterface();
  serverIface.addPublication('all', (sub) => {
    return [
      ReadableStream.from<ServerSentSubscriptionPacket>([
        {msg: 'added',collection:'numbers',id:'1',fields:{}},
        {msg: 'ready',subs:[]},
      ]),
      ReadableStream.from<ServerSentSubscriptionPacket>([
        {msg: 'added',collection:'letters',id:'a',fields:{}},
        {msg: 'ready',subs:[]},
      ]),
    ];
  });

  using session = await setupClientFor(serverIface);

  const sub = session.client.subscribe('all');
  await sub.ready;

  {
    const collection = session.client.getCollection('numbers');
    const items = await collection.find().fetchAsync();
    assertEquals(items.length, 1);
    assertObjectMatch(items[0], { _id: "1" });
  }

  {
    const collection = session.client.getCollection('letters');
    const items = await collection.find().fetchAsync();
    assertEquals(items.length, 1);
    assertObjectMatch(items[0], { _id: "a" });
  }
});
