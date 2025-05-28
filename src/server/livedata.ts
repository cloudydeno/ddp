// export function filterEventStream<T extends ApiKindEntity>(
//   stream: ReadableStream<StreamEvent<T>>,
//   filterCb: (entity: T) => boolean,
// ): ReadableStream<StreamEvent<T>> {
//   const visibleNames = new Set<string>;
//   return stream.pipeThrough(new TransformStream<StreamEvent<T>,StreamEvent<T>>({
//     transform(event, ctlr) {
//       switch (event.kind) {
//         case 'Creation':
//           if (!filterCb(event.snapshot)) break;
//           visibleNames.add(event.snapshot.metadata.name);
//           ctlr.enqueue(event);
//           break;
//         case 'Mutation': {
//           const prevResult = visibleNames.has(event.snapshot.metadata.name);
//           const newResult = filterCb(event.snapshot);
//           if (prevResult && newResult) {
//             ctlr.enqueue(event);
//           } else if (prevResult) {
//             visibleNames.delete(event.snapshot.metadata.name);
//             ctlr.enqueue({
//               kind: 'Deletion',
//               snapshot: event.snapshot,
//             });
//           } else if (newResult) {
//             visibleNames.add(event.snapshot.metadata.name);
//             ctlr.enqueue({
//               kind: 'Creation',
//               snapshot: event.snapshot,
//             });
//           }
//           break;
//         }
//         case 'Deletion': {
//           if (!visibleNames.delete(event.snapshot.metadata.name)) break;
//           ctlr.enqueue(event);
//           break;
//         }
//         default:
//           ctlr.enqueue(event);
//       }
//     },
//   }));
// }

import type { OutboundSubscription, ServerSentPacket } from "../../shared/ddp/types.ts";

export type SubscriptionEvent =
| (ServerSentPacket & {msg: 'added' | 'changed' | 'removed'})
| {msg: 'ready'}
| {msg: 'nosub', error?: Error}
;

// export function renderEventStream<T extends ApiKindEntity>(
//   stream: ReadableStream<StreamEvent<T>>,
//   collection: string,
//   idCb: (entity: T) => string,
//   fieldsCb: (entity: T) => DocumentFields,
// ): ReadableStream<SubscriptionEvent> {
//   return stream.pipeThrough(new TransformStream<StreamEvent<T>,SubscriptionEvent>({
//     transform(event, ctlr) {
//       switch (event.kind) {
//         case 'Creation':
//           ctlr.enqueue({
//             msg: 'added',
//             collection,
//             id: idCb(event.snapshot),
//             fields: fieldsCb(event.snapshot),
//           });
//           break;
//         case 'Mutation':
//           ctlr.enqueue({
//             msg: 'changed',
//             collection,
//             id: idCb(event.snapshot),
//             // TODO: this is incorrect with field removals
//             fields: fieldsCb(event.snapshot),
//           });
//           break;
//         case 'Deletion':
//           ctlr.enqueue({
//             msg: 'removed',
//             collection,
//             id: idCb(event.snapshot),
//           });
//           break;
//         case 'InSync':
//           ctlr.enqueue({
//             msg: 'ready',
//           });
//           break;
//         case 'LostSync':
//           ctlr.enqueue({
//             msg: 'nosub', // not sure tho
//           });
//           break;
//         case 'Error':
//           ctlr.enqueue({
//             msg: 'nosub',
//             error: new Error(event.message),
//           });
//           break;
//       }
//     },
//   }));
// }

export function emitToSub(
  sub: OutboundSubscription,
  sources: Array<ReadableStream<SubscriptionEvent>>,
) {
  let unreadyCount = sources.length;
  sources.map(source => source.pipeTo(new WritableStream({
    write(packet) {
      switch (packet.msg) {
        case 'ready':
          if (--unreadyCount == 0) {
            sub.ready();
          }
          break;
        case 'nosub':
          if (packet.error) {
            sub.error(packet.error);
          } else {
            sub.stop();
          }
          break;
        case 'added':
          sub.added(packet.collection, packet.id, packet.fields ?? {});
          break;
        case 'changed':
          sub.changed(packet.collection, packet.id, packet.fields ?? {});
          break;
        case 'removed':
          sub.removed(packet.collection, packet.id);
          break;
      }
    },
  })));
}
