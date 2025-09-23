import { type ConnectionOptions, type DialOptions, DdpConnection } from "../src/client/mod.ts";
import { DdpInterface, DdpStreamSession } from "../src/server/mod.ts";

/** Returns a client pointed at a blank, all-default server interface. */
export function setupBoringClient(clientOpts: Partial<ConnectionOptions> = {}) {
  return setupClientFor(new DdpInterface(), clientOpts);
}

/** Returns a client pointed at the given server interface. */
export function setupClientFor(serverIface: DdpInterface, clientOpts: Partial<ConnectionOptions> = {}) {
  const client = new DdpConnection('TESTCONN', {
    autoConnect: true, // false,
    encapsulation: 'raw',
    dialerFunc: makeTestDialerFunc(serverIface),
    ...clientOpts,
  });
  return client;
}

/** Establishes a 'connection' to the given server interface via a bidirectional stream pair. */
export function makeTestDialerFunc(serverIface: DdpInterface) {
  return function testDialerFunc(opts: DialOptions) {

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
      serverSession: server,
    });
  };
}
