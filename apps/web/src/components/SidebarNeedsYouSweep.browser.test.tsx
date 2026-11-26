import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";

import { dispatchedCommands, type FakeDriver } from "../../test/fakeEnvironment";
import { openWithLastThreadWaiting, rowOf } from "../../test/needsYouScene";

import "~/index.css";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

it("a settle sweep from a waiting row onto the row drawn under it settles exactly those two threads", async () => {
  await using scene = await openWithLastThreadWaiting("sweep", { acceptCommands: true });
  const at = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  };
  const pointer = { pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, buttons: 1 };
  // The rows are found once: a swept row shows its destination, so its text no longer finds it.
  const rows = {
    waiting: rowOf(scene.waiting),
    first: rowOf(scene.idle[0]!),
    second: rowOf(scene.idle[1]!),
  };
  const swept = (row: HTMLElement) =>
    (row.closest("li") ?? row).querySelector('[role="status"]') !== null;
  // A press on a row that has just moved is dropped for half a second (the shift guard), so the
  // sweep starts on the first try that is late enough. Each try gives the sweep 200 ms to show.
  const tryToStartSweep = async () => {
    const button = rows.waiting.querySelector<HTMLElement>('[aria-label="Settle thread"]')!;
    button.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, button: 0, ...at(button) }));
    const target = at(rows.first);
    // Past the drag distance first, then onto the row drawn under the waiting one.
    document.dispatchEvent(
      new PointerEvent("pointermove", { ...pointer, ...target, clientY: target.clientY - 40 }),
    );
    document.dispatchEvent(new PointerEvent("pointermove", { ...pointer, ...target }));
    try {
      await vi.waitFor(() => expect(swept(rows.waiting)).toBe(true), { timeout: 200 });
      return true;
    } catch {
      document.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0, ...target }));
      return false;
    }
  };
  let started = false;
  for (let attempt = 0; attempt < 20 && !started; attempt += 1) started = await tryToStartSweep();
  expect(started).toBe(true);
  expect(swept(rows.first)).toBe(true);
  expect(swept(rows.second)).toBe(false);
  document.dispatchEvent(
    new PointerEvent("pointerup", { ...pointer, buttons: 0, ...at(rows.first) }),
  );
  const settled = () =>
    dispatchedCommands().flatMap((command) =>
      command.type === "thread.settle" ? [String(command.threadId)] : [],
    );
  await vi.waitFor(() => expect(settled()).toHaveLength(2));
  expect(new Set(settled())).toEqual(new Set([scene.waiting.id, scene.idle[0]!.id]));
});
