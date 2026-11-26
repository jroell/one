import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";

import { page } from "vite-plus/test/browser";
import { useThreadSelectionStore } from "~/threadSelectionStore";
import {
  ENVIRONMENT_ID,
  emitShellUpdate,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { approvalRequest, drawnOrder, openApp, rowOf } from "../../test/needsYouScene";

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

it("a thread that starts waiting arms the shift guard, so a press on a row it pushed down is dropped", async () => {
  await page.viewport(1400, 900);
  useThreadSelectionStore.getState().clearSelection();
  const threads = [
    threadWithHistory("guard-a", 1),
    threadWithHistory("guard-b", 1),
    threadWithHistory("guard-c", 1),
  ];
  using _environment = installFakeEnvironment(threads);
  const routeThread = threads[0]!;
  const { app, focus } = await openApp(`/${ENVIRONMENT_ID}/${routeThread.id}`);
  await using _app = app;
  using _focus = focus;
  await vi.waitFor(() => expect(drawnOrder(threads)).toHaveLength(3), { timeout: 8000 });
  const natural = drawnOrder(threads);
  const waiting = threads.find((thread) => thread.id === natural[2])!;
  // A row the waiting one pushes down, and that is not the open thread, so a click that goes
  // through navigates to it.
  const pushedDown = threads.find(
    (thread) => thread.id !== routeThread.id && thread.id !== waiting.id,
  )!;
  const startPath = location.pathname;
  const before = rowOf(pushedDown).getBoundingClientRect().top;
  await emitShellUpdate(waiting.id, {
    pendingRuntimeRequest: approvalRequest(waiting.id),
  } as never);
  await vi.waitFor(() =>
    expect(rowOf(pushedDown).getBoundingClientRect().top).toBeGreaterThan(before),
  );
  // The press lands within half a second of the move, as one aimed at the old place would.
  const row = rowOf(pushedDown);
  const rect = row.getBoundingClientRect();
  const at = { clientX: rect.left + 40, clientY: rect.top + rect.height / 2, bubbles: true };
  const pointer = { ...at, pointerId: 3, isPrimary: true, button: 0, cancelable: true };
  row.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
  row.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
  row.dispatchEvent(new MouseEvent("click", { ...at, button: 0, cancelable: true }));
  // A press that went through would open the thread; give it its time, then expect it stayed.
  const navigated = await vi
    .waitFor(
      () => {
        if (location.pathname === startPath) throw new Error("still on the open thread");
        return true;
      },
      { timeout: 600 },
    )
    .catch(() => false);
  expect(navigated).toBe(false);
});
