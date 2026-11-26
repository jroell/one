import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { RuntimeRequestId } from "@t3tools/contracts";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { startWorkspaceFocus } from "~/lib/workspaceFocus";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  dispatchedCommands,
  emitShellUpdate,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";
import { isOptimisticDropReleased, planSidebarThreadDrop } from "./Sidebar.logic";

import "~/index.css";

// Spied, not replaced: the sidebar still runs the real planner, and the test reads what it was given.
vi.mock("./Sidebar.logic", { spy: true });

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

const PINNED_AT = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");

/**
 * Three pinned threads in the order A, B, C with saved keys b, c and z. B is waiting on an approval,
 * so the sidebar draws it in the need-you group and the pinned list shows A and C.
 */
async function openWithWaitingThread() {
  await page.viewport(1400, 900);
  const waiting = {
    ...threadWithHistory("pin-b", 1),
    pendingRuntimeRequest: {
      id: RuntimeRequestId.make("pin-b-request"),
      kind: "command_approval",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  } as unknown as ReturnType<typeof threadWithHistory>;
  const threads = [threadWithHistory("pin-a", 1), waiting, threadWithHistory("pin-c", 1)];
  const environment = installFakeEnvironment(threads, { acceptCommands: true });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${threads[0]!.id}`] }),
  );
  await router.load();
  const app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  const focus = { [Symbol.dispose]: startWorkspaceFocus(router) };
  await vi.waitFor(
    () => expect(document.querySelectorAll('[data-testid="sidebar-row-card"]')).toHaveLength(3),
    { timeout: 8000 },
  );
  await act(async () => {
    for (const [thread, key] of [
      [threads[0]!, "b"],
      [threads[1]!, "c"],
      [threads[2]!, "z"],
    ] as const) {
      await emitShellUpdate(thread.id, { pinnedAt: PINNED_AT, pinOrderKey: key });
    }
  });
  await vi.waitFor(() => expect(drawnOrder()).toEqual(["pin-b", "pin-a", "pin-c"]));
  return { app, environment, focus, threads };
}

/** Titles of the sidebar rows from top to bottom. */
function drawnOrder() {
  return [...document.querySelectorAll('[data-testid="sidebar-row-card"]')].map(
    (row) => /pin-[abc]/.exec(row.textContent ?? "")?.[0] ?? "",
  );
}

const row = (name: string) =>
  page.getByTestId("sidebar-row-card").filter({ hasText: name }).first();
const reorderCommands = () =>
  dispatchedCommands().filter((command) => command.type === "thread.pin.reorder");

it("a pinned reorder with a thread waiting plans and holds against the rows that are drawn, and writes one new key", async () => {
  const { app, environment, focus, threads } = await openWithWaitingThread();
  await using _app = app;
  using _environment = environment;
  using _focus = focus;

  vi.mocked(planSidebarThreadDrop).mockClear();
  vi.mocked(isOptimisticDropReleased).mockClear();
  await userEvent.dragAndDrop(row("pin-c"), row("pin-a"));

  await vi.waitFor(() => expect(reorderCommands()).toHaveLength(1));
  // The server has not echoed the new key, so the drawn order is the held one; before, the held
  // order was released at once because it was one row shorter than the pinned list.
  await vi.waitFor(() => expect(drawnOrder()).toEqual(["pin-b", "pin-c", "pin-a"]));

  // What the sidebar hands the planner and the release check is the list it draws: the waiting
  // thread is in neither, so a drop that does not involve it cannot rewrite or reorder around it.
  const waiting = `${ENVIRONMENT_ID}:${threads[1]!.id}`;
  const planned = vi.mocked(planSidebarThreadDrop).mock.calls;
  expect(planned.length).toBeGreaterThan(0);
  for (const [input] of planned) {
    expect(input.pinnedOrder, "pinned order given to the planner").not.toContain(waiting);
    expect(input.activeOrder, "active order given to the planner").not.toContain(waiting);
  }
  const releaseChecks = vi.mocked(isOptimisticDropReleased).mock.calls;
  expect(releaseChecks.length).toBeGreaterThan(0);
  for (const [input] of releaseChecks) {
    expect(input.pinnedKeys, "pinned keys given to the release check").not.toContain(waiting);
  }
  // The waiting thread's saved key is still known to the planner, so it stays reserved.
  expect(planned.at(-1)![0].pinnedKeysById.get(waiting)).toBe("c");
});
