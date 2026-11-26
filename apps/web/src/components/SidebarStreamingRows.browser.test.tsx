import { RunId } from "@t3tools/contracts";
import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { startWorkspaceFocus } from "~/lib/workspaceFocus";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  emitShellUpdate,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";

import "~/index.css";

// React reports each commit to a DevTools hook installed before it loads. The hook counts, per
// thread id, how many times each thread row component rendered, and how many times the sidebar
// itself did.
const renders = vi.hoisted(() => {
  const rows = new Map<string, number>();
  const sidebar = { count: 0 };
  interface Fiber {
    child: Fiber | null;
    sibling: Fiber | null;
    alternate: Fiber | null;
    flags: number;
    type: unknown;
    memoizedProps: Record<string, unknown> | null;
  }
  const PERFORMED_WORK = 1;
  const bump = (map: Map<string, number>, id: string) => map.set(id, (map.get(id) ?? 0) + 1);
  // A fiber left untouched by a commit keeps the flags of its last render, so count only fibers
  // that were not in the previous commit's tree.
  let previous = new WeakSet<object>();
  const walk = (root: Fiber) => {
    const current = new WeakSet<object>();
    const visit = (fiber: Fiber | null) => {
      for (let node = fiber; node; node = node.sibling) {
        current.add(node);
        const type = node.type as { name?: string } | null;
        const rendered =
          !previous.has(node) && node.alternate !== null && (node.flags & PERFORMED_WORK) !== 0;
        if (rendered && typeof type === "function") {
          const thread = node.memoizedProps?.thread as { id?: string } | undefined;
          if (type.name === "SidebarThreadRow" && thread?.id !== undefined) bump(rows, thread.id);
          if (type.name === "Sidebar") sidebar.count += 1;
        }
        visit(node.child);
      }
    };
    visit(root);
    previous = current;
  };
  Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
    configurable: true,
    value: {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      checkDCE: () => {},
      onScheduleFiberRoot: () => {},
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => walk(root.current),
    },
  });
  return {
    rows,
    sidebar,
    clear: () => {
      rows.clear();
      sidebar.count = 0;
    },
  };
});

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

const LISTED = 40;

it("a streamed turn re-renders the streaming thread's row and no other thread row", async () => {
  await page.viewport(1400, 900);
  const threads = Array.from({ length: LISTED }, (_, index) =>
    threadWithHistory(`row-${index}`, 1),
  );
  const streaming = threads[0]!;
  using _environment = installFakeEnvironment(threads);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${streaming.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });
  using _focus = { [Symbol.dispose]: startWorkspaceFocus(router) };
  await vi.waitFor(
    () => expect(document.querySelectorAll('[data-testid="sidebar-row-card"]').length).toBe(LISTED),
    { timeout: 8000 },
  );
  await act(async () => {});

  const runId = RunId.make("row-0-run-1");
  const at = (second: number) =>
    DateTime.makeUnsafe(`2026-03-17T19:13:${String(second).padStart(2, "0")}.000Z`);
  const running = {
    status: "running" as const,
    activeRunId: runId,
    latestRunId: runId,
  };
  const others = (counts: Map<string, number>) =>
    [...counts].filter(([id]) => id !== streaming.id).reduce((sum, [, n]) => sum + n, 0);

  // The turn starts: the thread's status really changes, so its row and the list may update.
  await act(async () => {
    await emitShellUpdate(streaming.id, { ...running, updatedAt: at(1) });
  });
  await act(async () => {});

  // Layout observers and clocks in the list settle on their own after a change; wait for that so
  // the counts below are the stream's.
  const settled = () => {
    let previous = -1;
    return vi.waitFor(
      () => {
        const total = [...renders.rows.values()].reduce((sum, n) => sum + n, 0);
        renders.clear();
        const quiet = total === 0 && previous === 0;
        previous = total;
        expect(quiet, "rows still rendering").toBe(true);
      },
      { timeout: 10_000, interval: 300 },
    );
  };
  await settled();

  // Ten streamed ticks change only timestamps, counts and the latest message.
  renders.clear();
  for (let tick = 1; tick <= 10; tick++) {
    await act(async () => {
      await emitShellUpdate(streaming.id, {
        ...running,
        updatedAt: at(1 + tick),
        itemCount: 2 + tick,
        visibleItemCount: 2 + tick,
      });
    });
  }
  expect(renders.sidebar.count, "sidebar renders during ten streaming ticks").toBe(0);
  expect(others(renders.rows), "other thread rows rendered during streaming ticks").toBe(0);

  // The turn names the thread, which the sidebar shows. The sidebar renders for it, and every other
  // row keeps what it rendered.
  await settled();
  renders.clear();
  await act(async () => {
    await emitShellUpdate(streaming.id, {
      ...running,
      title: "A thread with a new name",
      updatedAt: at(20),
      itemCount: 14,
      visibleItemCount: 14,
    });
  });
  await act(async () => {});
  expect(renders.sidebar.count, "the sidebar renders for the new name").toBeGreaterThan(0);
  expect(others(renders.rows), "other thread rows rendered when one thread was renamed").toBe(0);
});
