type Status =
| 'connected' // the connection is up and running
| 'connecting' // disconnected and trying to open a new connection
| 'failed' // permanently failed to connect; e.g., the client and server support different versions of DDP
| 'waiting' // failed to connect and waiting to try to reconnect
| 'offline' // user has disconnected the connection
;

export type ConnectionStatus = {
  connected: boolean;
  status: Status;
  retryCount: number;
  retryTimeNumber?: number;
  reason?: string;
};

export type ConnectionOptions = {
  encapsulation: 'sockjs' | 'raw';
  autoConnect: boolean;
  // autoReconnect?: boolean;
  /** Custom callback to connect to the server, instead of WebSocketStream */
  dialerFunc?: (url: string, encapsulation: 'sockjs' | 'raw') => Promise<{
    readable: ReadableStream<string>,
    writable: WritableStream<string>,
  }>;
}

export interface DdpSubscription {
  readonly subId: string;
  readonly ready: Promise<void>;
  stop(): void;
}
