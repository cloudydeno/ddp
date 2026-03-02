import { assertEquals } from '@std/assert/equals';

import { DDP } from "@cloudydeno/ddp/client";
import { makeTestDialerFunc } from "./util.ts";
import { DdpInterface } from "@cloudydeno/ddp/server";

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

Deno.test('connection eof reconnect', {
  permissions: 'none',
}, async () => {

  using client = DDP.connect('http://localhost:8000', {
    // Wrap the dial logic to force a shutdown after 1 second
    dialerFunc: async (opts) => {
      const func = makeTestDialerFunc(new DdpInterface());
      const session = await func({ ...opts,
        signal: AbortSignal.timeout(1000),
      });
      return session;
    },
    // Configure client to always wait 1 second before retrying
    reconnectDelayMillis: 1000,
  });

  client.connect();
  assertEquals(client.status.status, 'connecting');

  await new Promise(ok => setTimeout(ok, 500));
  assertEquals(client.status.status, 'connected');
  await new Promise(ok => setTimeout(ok, 1000));
  assertEquals(client.status.status, 'waiting');
  await new Promise(ok => setTimeout(ok, 1000));
  assertEquals(client.status.status, 'connected');
  await new Promise(ok => setTimeout(ok, 1000));
  assertEquals(client.status.status, 'waiting');

  client.disconnect();
  assertEquals(client.status.status, 'offline');
  // await new Promise(ok => setTimeout(ok, 100));
});
