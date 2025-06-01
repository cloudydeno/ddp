import type { DdpInterface } from "./interface.ts";

// TODO: mutate payloads with server-supplied attributes

async function otlpProxy(url: string, body: unknown) {
  const resp = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
    },
  });
  if (!resp.ok) throw new Error(`OTLP submission error: HTTP ${resp.status}`);
  return await resp.json();
}

export function registerOtlpMethods(ddp: DdpInterface) {
  const otlpEndpoint = Deno.env.get('OTEL_EXPORTER_OTLP_ENDPOINT');
  if (!otlpEndpoint) return;

  ddp.addMethod('OTLP/server-time', () => Date.now());
  ddp.addMethod('OTLP/v1/traces', async (_socket, [body]) => {
    return await otlpProxy(`${otlpEndpoint}/v1/traces`, body);
  });
  ddp.addMethod('OTLP/v1/metrics', async (_socket, [body]) => {
    return await otlpProxy(`${otlpEndpoint}/v1/metrics`, body);
  });
  ddp.addMethod('OTLP/v1/logs', async (_socket, [body]) => {
    return await otlpProxy(`${otlpEndpoint}/v1/logs`, body);
  });
}
