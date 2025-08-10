import { setupBoringClient } from "./util.ts";

Deno.test('explicit disconnect/connect cycle', {
  permissions: 'none',
}, async () => {
  using client = setupBoringClient();

  await client.ping();
  client.disconnect();

  client.connect();
  await client.ping();
});

Deno.test('offline queue during disconnect/connect', {
  permissions: 'none',
}, async () => {
  using client = setupBoringClient();

  await client.ping();
  client.disconnect();

  // Shouldn't resolve until the client reconnects:
  const pingPromise = client.ping();

  client.connect();
  await client.ping();

  // The offline ping should be resolved now:
  await pingPromise;
});
