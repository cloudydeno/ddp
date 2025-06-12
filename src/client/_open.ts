import { trace } from "@cloudydeno/opentelemetry/pkg/api";
import { EJSON } from "@cloudydeno/ejson";

import type { ServerSentPacket } from "lib/types.ts";
import type { DdpClientSocket } from "./socket.ts";

const clientTracer = trace.getTracer('ddp.client');

export async function openWebsocketStream(appUrl: string, encapsulation: 'sockjs' | 'raw'): Promise<WebSocketConnection> {
  let sockPath = 'websocket';

  if (encapsulation == 'sockjs') {
    const shardId = Math.floor(Math.random()*1000);
    const sessionId = Math.random().toString(16).slice(2, 10);
    sockPath = `sockjs/${shardId}/${sessionId}/${sockPath}`;
  }

  const sockUrl = new URL(sockPath, appUrl);
  sockUrl.protocol = sockUrl.protocol.replace(/^http/, 'ws');
  const wss = new WebSocketStream(sockUrl.toString());

  const connectSpan = clientTracer.startSpan('DDP connection');
  return await wss.opened.finally(() => connectSpan.end());
}

export async function runHandshake(
  socket: DdpClientSocket,
  readable: ReadableStream<string>,
): Promise<void> {
  const setupReader = readable.getReader() as ReadableStreamDefaultReader<string>;

  const handshakeSpan = clientTracer.startSpan('DDP handshake');
  try {
    await socket.sendMessage({
      msg: "connect",
      version: "1",
      support: ["1"],
    });

    if (socket.encapsulation == 'sockjs') {
      {
        const {value} = await setupReader.read();
        if (value !== 'o') throw new Error(`Unexpected banner: ${JSON.stringify(value)}`)
      }

      // TODO: the parsing should be handled by a transformstream, read from that instead
      const {value} = await setupReader.read();
      if (value?.[0] !== 'a') throw new Error(`Unexpected connect resp: ${JSON.stringify(value)}`)
      const packet = EJSON.parse(JSON.parse(value.slice(1))[0]) as ServerSentPacket;
      if (packet.msg !== 'connected') throw new Error(`Unexpected connect msg: ${JSON.stringify(packet)}`);
      // const session = packet.session as string;

    } else {
      const {value} = await setupReader.read();
      if (value?.[0] !== '{') throw new Error(`Unexpected connect resp: ${JSON.stringify(value)}`)
      const packet = EJSON.parse(value) as ServerSentPacket;
      if (packet.msg !== 'connected') throw new Error(`Unexpected connect msg: ${JSON.stringify(packet)}`);
    }
  } finally {
    handshakeSpan.end();
  }

  setupReader.releaseLock();
}
