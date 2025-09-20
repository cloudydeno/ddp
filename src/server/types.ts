import type { EJSONableProperty } from "@cloudydeno/ejson";

import type { RandomStream } from "lib/random.ts";
import type { ClientSentPacket, MeteorError, ServerSentDocumentPacket } from "lib/types.ts";
import type { DdpSession } from "./session.ts";
import type { DdpSessionSubscription } from "./subscription.ts";

export type PublicationEvent = {
  msg: 'ready';
} | {
  msg: 'nosub';
  error?: unknown;
} | ServerSentDocumentPacket;

export type PublishStream = ReadableStream<PublicationEvent>;

export type ConnectionHandler = (socker: DdpSession) => void;
export type MethodHandler = (socket: DdpSession, params: EJSONableProperty[], random: RandomStream | null) => EJSONableProperty | Promise<EJSONableProperty>;
export type PublicationHandler = (socket: DdpSessionSubscription, params: EJSONableProperty[]) => Promise<void | PublishStream[]> | void | PublishStream[];

// We add an extra field on DDP requests for distributed tracing.
// This is compatible with the meteor package "danopia:opentelemetry".
export type TracedClientSentPacket = ClientSentPacket & {
  baggage?: Record<string, string>;
};

export interface OutboundSubscription {
  stop(error?: MeteorError): void;
  onStop(callback: () => void): void;
  // get signal(): AbortSignal;

  get userId(): string | null;

  added(collection: string, id: string, fields: Record<string,EJSONableProperty>): void;
  changed(collection: string, id: string, fields: Record<string,EJSONableProperty>): void;
  removed(collection: string, id: string): void;

  error(error: Error): void;
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
