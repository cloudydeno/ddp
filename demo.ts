import { DdpConnection } from "@cloudydeno/ddp/client";

const DdpServerUrl = Deno.env.get('DDP_SERVER_URL');
if (!DdpServerUrl) throw `Need DDP_SERVER_URL=https://...`;

const DdpResumeToken = Deno.env.get('DDP_RESUME_TOKEN');

const conn = new DdpConnection(DdpServerUrl, {
  encapsulation: 'raw',
  autoConnect: true,
  fetchAuthFunc: () => DdpResumeToken ? ({
    resume: DdpResumeToken,
  }) : null,
});

console.log(new Date, 'DDP status:', conn.liveStatus.getSnapshot().status);
conn.liveStatus.subscribe(() => {
  console.log(new Date, 'DDP status update:', conn.liveStatus.getSnapshot().status);
});
