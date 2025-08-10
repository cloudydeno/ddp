import { assertEquals } from "jsr:@std/assert@1.0.13/equals";
import { assertObjectMatch } from "jsr:@std/assert@1.0.13/object-match";

import type { ServerSentSubscriptionPacket } from "lib/types.ts";
import { DdpInterface } from "../src/server/interface.ts";
import { setupClientFor } from "./util.ts";

Deno.test('cursor subscribe', {
  permissions: 'none',
}, async () => {

  const serverIface = new DdpInterface();
  serverIface.addPublication('all', () => {
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

  using client = setupClientFor(serverIface);
  await client.ping();

  const sub = client.subscribe('all');
  await sub.ready;

  {
    const collection = client.getCollection('numbers');
    const items = await collection.find().fetchAsync();
    assertEquals(items.length, 1);
    assertObjectMatch(items[0], { _id: "1" });
  }

  {
    const collection = client.getCollection('letters');
    const items = await collection.find().fetchAsync();
    assertEquals(items.length, 1);
    assertObjectMatch(items[0], { _id: "a" });
  }
});
