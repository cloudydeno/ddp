import type { EJSONableProperty } from "@cloudydeno/ejson";

import type { RandomStream } from "lib/random.ts";
import type { DdpSession } from "./session.ts";
import type { DdpSessionSubscription } from "./subscription.ts";
import type { ConnectionHandler, MethodHandler, PublicationHandler, PublishStream } from "./types.ts";

export class DdpInterface {
  private readonly connectionCbs: Set<ConnectionHandler> = new Set;
  private readonly methods: Map<string, MethodHandler> = new Map;
  private readonly defaultPubs: Array<{ label: string, handler: PublicationHandler }> = [];
  private readonly publications: Map<string, PublicationHandler> = new Map;
  // /** @deprecated TODO: This doesn't appear to be used for anything */
  // private readonly openSockets: Set<DdpSession> = new Set;

  onConnection(handler: ConnectionHandler): { stop(): void } {
    this.connectionCbs.add(handler);
    return {
      stop: () => {
        this.connectionCbs.delete(handler);
      },
    };
  }

  addMethod(name: string, handler: MethodHandler): void {
    this.methods.set(name, handler);
  }
  addPublication(name: string, handler: PublicationHandler): void {
    this.publications.set(name, handler);
  }
  addDefaultPublication(label: string, handler: PublicationHandler): void {
    this.defaultPubs.push({ label, handler });
  }

  registerSocket(socket: DdpSession): void {
    // this.openSockets.add(socket);
    for (const callback of this.connectionCbs) {
      callback(socket);
    }
    // socket.closePromise
    //   .catch(err => {
    //     console.warn(`WebSocket walked away: ${err}`);
    //   })
    //   .finally(() => {
    //     this.openSockets.delete(socket);
    //   });
    for (const pub of this.defaultPubs) {
      socket.startDefaultSub(pub.label, pub.handler);
    }
  }

  async callMethod(socket: DdpSession, name: string, params: EJSONableProperty[], random: RandomStream | null): Promise<EJSONableProperty> {
    const handler = this.methods.get(name);
    if (!handler) {
      throw new Error(`unimplemented method: "${name}"`);
    }
    return await handler(socket, params, random);
  }

  async callSubscribe(sub: DdpSessionSubscription, name: string, params: EJSONableProperty[]): Promise<void | PublishStream[]> {
    const handler = this.publications.get(name);
    if (!handler) {
      throw new Error(`unimplemented sub: "${name}"`);
    }
    return await handler(sub, params);
  }
}
