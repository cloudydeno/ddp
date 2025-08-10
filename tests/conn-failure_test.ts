import { assertEquals } from '@std/assert/equals';

import { DDP } from "@cloudydeno/ddp/client";

Deno.test('connection failure methods', {
  permissions: 'none',
}, async () => {

  using client = DDP.connect('http://localhost:8000', {
    dialerFunc: () => Promise.reject('test reject'),
  });

  client.connect();
  assertEquals(client.status.status, 'connecting');

  await new Promise(ok => setTimeout(ok, 10));
  assertEquals(client.status.status, 'waiting');
  client.disconnect();
});
