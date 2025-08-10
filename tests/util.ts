import { type ConnectionOptions, DdpConnection } from "../src/client/mod.ts";
import { DdpInterface } from "../src/server/interface.ts";
import { DdpStreamSession } from "../src/server/session.ts";

export function setupClientWithoutInterface() {
  return setupClientFor(new DdpInterface());
}

export function setupClientFor(serverIface: DdpInterface, clientOpts: Partial<ConnectionOptions> = {}) {

  const client = new DdpConnection('TESTCONN', {
    autoConnect: true, // false,
    encapsulation: 'raw',
    dialerFunc(opts) {

      const clientToServer = new TransformStream<string>();
      const serverToClient = new TransformStream<string>();

      const server = new DdpStreamSession(
        serverIface,
        clientToServer.readable,
        serverToClient.writable);

      // Shut down backend if the caller wants us to become disconnected
      opts.signal?.addEventListener('abort', () => {
        server.close();
      });

      return Promise.resolve({
        readable: serverToClient.readable,
        writable: clientToServer.writable,
      });
    },
    ...clientOpts,
  });

  return {
    client,
    ping: () => client.ping(),
    [Symbol.dispose]: async () => {
      await client.ping();
      client.disconnect();
    },
  };
}
