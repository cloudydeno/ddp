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
  /** Optionally send extra HTTP request headers when connecting to the server */
  additionalHeaders?: HeadersInit;
  /** Custom callback to connect to the server, instead of WebSocketStream */
  dialerFunc?: (options: DialOptions) => Promise<{
    readable: ReadableStream<string>,
    writable: WritableStream<string>,
  }>;
}

export type DialOptions = {
  appUrl: string;
  encapsulation: 'sockjs' | 'raw';
  signal?: AbortSignal;
  headers?: HeadersInit;
};

export interface DdpSubscription {
  readonly subId: string;
  readonly ready: Promise<void>;
  stop(): void;
}
