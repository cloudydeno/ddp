import { assertEquals } from "@std/assert/equals";
import { setupBoringClient } from "./util.ts";

Deno.test('initial status without autoconnect', {
  permissions: 'none',
}, () => {
  using client = setupBoringClient({
    autoConnect: false,
  });
  assertEquals(client.status.connected, false);
  assertEquals(client.status.status, 'offline');
});

Deno.test('status thru connection lifecycle', {
  permissions: 'none',
}, async () => {
  using client = setupBoringClient();
  assertEquals(client.status.connected, false);
  assertEquals(client.status.status, 'connecting');

  await client.ping();
  assertEquals(client.status.connected, true);
  assertEquals(client.status.status, 'connected');

  client.disconnect();
  assertEquals(client.status.connected, false);
  assertEquals(client.status.status, 'offline');
});

Deno.test('status thru manual reconnection', {
  permissions: 'none',
}, async () => {
  using client = setupBoringClient();

  await client.ping();
  assertEquals(client.status.connected, true);
  assertEquals(client.status.status, 'connected');

  client.disconnect();
  assertEquals(client.status.connected, false);
  assertEquals(client.status.status, 'offline');

  client.connect();
  assertEquals(client.status.connected, false);
  assertEquals(client.status.status, 'connecting');

  await client.ping();
  assertEquals(client.status.connected, true);
  assertEquals(client.status.status, 'connected');
});

Deno.test('live status callbacks', {
  permissions: 'none',
}, async () => {
  using client = setupBoringClient();

  const statusList = [client.status.status];
  client.liveStatus.subscribe(() => {
    statusList.push(client.status.status);
  })

  await client.ping();
  client.disconnect();
  client.connect();
  await client.ping();

  assertEquals(statusList, [
    'connecting',
    'connected',
    'offline',
    'connecting',
    'connected',
  ]);
});

Deno.test('live status callback shutdown', {
  permissions: 'none',
}, async () => {
  using client = setupBoringClient();

  const statusList = [client.status.status];
  const cancelFunc = client.liveStatus.subscribe(() => {
    statusList.push(client.status.status);
  })

  await client.ping();
  client.disconnect();

  // Should stop getting callbacks after this
  cancelFunc();

  client.connect();
  await client.ping();

  assertEquals(statusList, [
    'connecting',
    'connected',
    'offline',
  ]);
});
