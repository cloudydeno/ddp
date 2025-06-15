import { DdpConnection } from "../src/client/mod.ts";
import type { DdpInterface } from "../src/server/interface.ts";
import { DdpStreamSession } from "../src/server/session.ts";

export function setupClientFor(serverIface: DdpInterface) {

  const clientToServer = new TransformStream<string>();
  const serverToClient = new TransformStream<string>();

  const server = new DdpStreamSession(serverIface, clientToServer.readable, serverToClient.writable);

  const client = new DdpConnection('TESTCONN', {
    autoConnect: false,
    encapsulation: 'raw',
  });

  return {
    client,
    server,
    async connect() {
      await client.connectToStreams({
        readable: serverToClient.readable,
        writable: clientToServer.writable,
      });
    },
    [Symbol.dispose]: () => server.close(),
  };
}
