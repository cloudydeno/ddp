import type { DdpInterface } from "./interface.ts";
import { DdpSocketSession } from "./session.ts";

export function serveWebsocket(
  req: Request,
  connInfo: Deno.ServeHandlerInfo,
  ddpInterface: DdpInterface,
): Response {
  const upgrade = req.headers.get("upgrade") ?? "";
  if (upgrade.toLowerCase() != "websocket") {
    return new Response("request isn't trying to upgrade to websocket.", {
      status: 400,
    });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  const ddp = new DdpSocketSession(
    socket,
    ddpInterface,
    'raw',
    connInfo.remoteAddr,
    Object.fromEntries(req.headers),
  );
  ddp.closePromise?.then(() => {}, () => {});
  return response;
}
