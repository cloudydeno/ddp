import { assertEquals } from "@std/assert/equals";
import { DdpInterface } from "../src/server/interface.ts";
import { setupBoringClient, setupClientFor } from "./util.ts";

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

Deno.test('logging in on reconnection', {
  permissions: 'none',
}, async () => {
  let currentPassnum = 0;

  const serverIface = new DdpInterface();
  serverIface.addMethod('login', (session, params) => {
    const input = params[0] as {passnum: number};
    if (input.passnum !== currentPassnum) throw new Error(`Invalid passnum`);
    const userId = `passnum-${input.passnum}`;
    session.setUserId(userId);
    return { id: userId };
  });
  serverIface.addMethod('whoami', (session) => {
    return session.userId;
  });

  using client = setupClientFor(serverIface, {
    fetchAuthFunc: () => ({
      passnum: currentPassnum,
    }),
  });

  currentPassnum = 2;
  // await client.ping();
  await client.liveStatus.waitFor(x => x.status == 'connected');
  assertEquals(client.userId, 'passnum-2');
  assertEquals(await client.callMethod('whoami', []), 'passnum-2');
  client.disconnect();

  currentPassnum = 3;
  client.connect();
  await client.liveStatus.waitFor(x => x.status == 'connected');
  assertEquals(client.userId, 'passnum-3');
  assertEquals(await client.callMethod('whoami', []), 'passnum-3');
});
