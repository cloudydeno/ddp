import { DdpConnection } from "./connection.ts";
import type { ConnectionOptions } from "./types.ts";

export { DdpConnection } from './connection.ts';
export { DdpClientSocket } from './socket.ts';
export type * from './types.ts';

export const DDP: {

  connect(
    url: string,
    opts?: Partial<ConnectionOptions>
  ): DdpConnection;

} = {

  connect(url, opts) {
    return new DdpConnection(url, {
      autoConnect: true,
      encapsulation: 'raw',
      ...opts,
    });
  },

};
