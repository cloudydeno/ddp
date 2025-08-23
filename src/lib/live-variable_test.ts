import { LiveVariable } from "@cloudydeno/ddp/live-variable";
import { assertEquals } from "@std/assert/equals";

Deno.test('LiveVariable basics', () => {
  const vari = new LiveVariable(5);
  assertEquals(vari.getSnapshot(), 5);
  vari.setSnapshot(6);
  assertEquals(vari.getSnapshot(), 6);
});

Deno.test('LiveVariable subscribe', () => {
  const vari = new LiveVariable(5);
  const seen = new Array<number>;
  const sub = vari.subscribe(() => {
    seen.push(vari.getSnapshot());
  });
  vari.setSnapshot(6);
  vari.setSnapshot(7);
  vari.setSnapshot(8);
  sub();
  vari.setSnapshot(9);
  vari.setSnapshot(10);
  assertEquals(seen, [6,7,8]);
});

Deno.test('LiveVariable waitFor callback', async () => {
  const vari = new LiveVariable(5);
  const seen = new Array<number>;
  const waiting = vari.waitFor(val => {
    seen.push(val);
    return val == 7;
  });
  vari.setSnapshot(6);
  vari.setSnapshot(6);
  vari.setSnapshot(7);
  vari.setSnapshot(7);
  vari.setSnapshot(8);
  vari.setSnapshot(8);
  await waiting;
  assertEquals(seen, [5,6,7]);
});

Deno.test('LiveVariable waitForValue', async () => {
  const vari = new LiveVariable(5);
  assertEquals(vari.getSnapshot(), 5);
  const waitFor6 = vari.waitForValue(6);
  vari.setSnapshot(6);
  await waitFor6;
});
