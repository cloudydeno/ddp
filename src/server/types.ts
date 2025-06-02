import type { EJSONableProperty } from "@cloudydeno/ejson";

import type { RandomStream } from "lib/random.ts";
import type { ClientSentPacket, ServerSentSubscriptionPacket } from "lib/types.ts";
import type { DdpSession } from "./session.ts";
import type { DdpSessionSubscription } from "./subscription.ts";

export type PublishStream = ReadableStream<ServerSentSubscriptionPacket>;

export type ConnectionHandler = (socker: DdpSession) => void;
export type MethodHandler = (socket: DdpSession, params: EJSONableProperty[], random: RandomStream | null) => EJSONableProperty | Promise<EJSONableProperty>;
export type PublicationHandler = (socket: DdpSessionSubscription, params: EJSONableProperty[]) => Promise<void | PublishStream[]> | void | PublishStream[];

// We add an extra field on DDP requests for distributed tracing.
// This is compatible with the meteor package "danopia:opentelemetry".
export type TracedClientSentPacket = ClientSentPacket & {
  baggage?: Record<string, string>;
};
