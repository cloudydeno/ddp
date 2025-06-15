import { ConnectionOptions, DdpConnection } from "../src/client/mod.ts";
import type { DdpInterface } from "../src/server/interface.ts";
import { DdpStreamSession } from "../src/server/session.ts";

export function setupClientFor(serverIface: DdpInterface, clientOpts: Partial<ConnectionOptions> = {}) {

  const clientToServer = new TransformStream<string>();
  const serverToClient = new TransformStream<string>();

  const server = new DdpStreamSession(serverIface, clientToServer.readable, serverToClient.writable);

  const client = new DdpConnection('TESTCONN', {
    autoConnect: true, // false,
    encapsulation: 'raw',
    dialerFunc: () => Promise.resolve({
      readable: serverToClient.readable,
      writable: clientToServer.writable,
    }),
    ...clientOpts,
  });

  return {
    client,
    server,
    ping: () => client.ping(),
    // async connect() {
    //   await client.connectToStreams({
    //   });
    // },
    [Symbol.dispose]: async () => {
      await client.ping();
      server.close();
    },
  };
}
