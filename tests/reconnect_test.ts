import { setupClientWithoutInterface } from "./util.ts";

Deno.test('explicit disconnect/connect cycle', {
  permissions: 'none',
}, async () => {
  using session = setupClientWithoutInterface();
  const { client } = session;

  await client.ping();
  session.client.disconnect();

  session.client.connect();
  await session.ping();
});

Deno.test('offline queue during disconnect/connect', {
  permissions: 'none',
}, async () => {
  using session = setupClientWithoutInterface();
  const { client } = session;

  await client.ping();
  client.disconnect();

  // Shouldn't resolve until the client reconnects:
  const pingPromise = client.ping();

  client.connect();
  await client.ping();

  // The offline ping should be resolved now:
  await pingPromise;
});
