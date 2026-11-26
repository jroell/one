import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";

import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { userEvent } from "vite-plus/test/browser";
import { useThreadSelectionStore } from "~/threadSelectionStore";
import { ENVIRONMENT_ID, type FakeDriver } from "../../test/fakeEnvironment";
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

it("shift-click from a waiting row to the row drawn under it selects exactly those two rows", async () => {
  await using scene = await openWithLastThreadWaiting("range");
  // The anchor is the waiting row, as after a modifier-click on it.
  useThreadSelectionStore
    .getState()
    .toggleThread(scopedThreadKey(scopeThreadRef(ENVIRONMENT_ID, scene.waiting.id)));
  // A press on a row that has just moved is dropped for half a second (the shift guard), so the
  // click is repeated until one is late enough to count.
  await vi.waitFor(
    async () => {
      await userEvent.click(rowOf(scene.idle[0]!), { modifiers: ["Shift"] });
      expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBeGreaterThan(1);
    },
    { timeout: 6000 },
  );
  const selected = [...useThreadSelectionStore.getState().selectedThreadKeys];
  expect(selected).toHaveLength(2);
  expect(selected.some((key) => key.includes(scene.waiting.id))).toBe(true);
  expect(selected.some((key) => key.includes(scene.idle[0]!.id))).toBe(true);
  expect(selected.some((key) => key.includes(scene.idle[1]!.id))).toBe(false);
});
