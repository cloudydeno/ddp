import type { EJSONableProperty } from "@cloudydeno/ejson";

export type ClientSentPacket = {
  msg: 'ping' | 'pong';
  id?: string;
} | {
  msg: 'connect';
  version: string;
  support: string[];
} | {
  msg: 'method';
  id: string;
  method: string;
  params: EJSONableProperty[];
  randomSeed?: string;
} | {
  msg: 'sub';
  id: string;
  name: string;
  params: EJSONableProperty[];
} | {
  msg: 'unsub';
  id: string;
};

export interface MeteorError {
  isClientSafe?: boolean;
  error?: number | string;
  reason?: string;
  message?: string;
  details?: string;
  errorType?: string; // e.g. "Meteor.Error"
};

export type DocumentFields = Record<string, EJSONableProperty>;

export type ServerSentDocumentPacket = {
  msg: 'added';
  collection: string;
  id: string;
  fields?: DocumentFields;
} | {
  msg: 'changed';
  collection: string;
  id: string;
  fields?: DocumentFields;
  cleared?: Array<string>;
} | {
  msg: 'removed';
  collection: string;
  id: string;
} | {
  msg: 'addedBefore';
  collection: string;
  id: string;
  fields?: DocumentFields;
  before: string | null;
} | {
  msg: 'movedBefore';
  collection: string;
  id: string;
  before: string | null;
};

export type ServerSentSubscriptionPacket = {
  msg: 'ready';
  subs: string[];
} | {
  msg: 'nosub';
  id: string;
  error?: MeteorError;
} | ServerSentDocumentPacket;

export type ServerSentMethodPacket = {
  msg: 'updated';
  methods: string[];
} | {
  msg: 'result';
  id: string;
  result?: EJSONableProperty;
  error?: undefined;
} | {
  msg: 'result';
  id: string;
  result?: undefined;
  error: MeteorError;
};

export type ServerSentLifecyclePacket = {
  msg: 'ping' | 'pong';
  id?: string;
} | {
  msg: 'connected';
  session: string;
} | {
  msg: 'failed';
  version: string;
} | {
  msg: 'error';
  reason: string;
  offendingMessage?: ClientSentPacket;
};

export type ServerSentPacket =
| ServerSentLifecyclePacket
| ServerSentSubscriptionPacket
| ServerSentMethodPacket
;

export interface OutboundSubscription {
  stop(error?: MeteorError): void;
  onStop(callback: () => void): void;
  // get signal(): AbortSignal;

  get userId(): string | null;

  added(collection: string, id: string, fields: Record<string,EJSONableProperty>): void;
  changed(collection: string, id: string, fields: Record<string,EJSONableProperty>): void;
  removed(collection: string, id: string): void;

  error(error: Error ): void;
  ready(): void;

  connection: ClientConnection;
  unblock(): void;
}

export interface ClientConnection {
  id: string;
  close: () => void;
  onClose: (callback: () => void) => void;
  clientAddress: string;
  httpHeaders: Record<string, string>;
}
