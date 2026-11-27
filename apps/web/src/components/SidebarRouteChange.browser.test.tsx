import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { startWorkspaceFocus } from "~/lib/workspaceFocus";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";

import "~/index.css";

// React reports each commit to a DevTools hook installed before it loads. The hook walks the
// committed tree and records, per thread id, which props changed on every memoized thread row
// that rendered. A row that renders with no changed prop is waking for its own state (a clock, a
// store), not for the route; one that renders with a changed handler is the memo being defeated.
const rowRenders = vi.hoisted(() => {
  const changed = new Map<string, Set<string>>();
  /** How many times a sortable row function ran, whatever woke it (a context counts too). */
  const sortableRowRuns = { count: 0 };
  interface Fiber {
    child: Fiber | null;
    sibling: Fiber | null;
    alternate: Fiber | null;
    flags: number;
    type: unknown;
    memoizedProps: Record<string, unknown> | null;
  }
  const PERFORMED_WORK = 1;
  const walk = (fiber: Fiber | null) => {
    for (let node = fiber; node; node = node.sibling) {
      const type = node.type as { name?: string } | null;
      const thread = node.memoizedProps?.thread as { id?: string } | undefined;
      const previous = node.alternate?.memoizedProps;
      if (
        typeof type === "function" &&
        type.name === "SidebarThreadRow" &&
        thread?.id !== undefined &&
        previous &&
        (node.flags & PERFORMED_WORK) !== 0
      ) {
        const current = node.memoizedProps!;
        const keys = Object.keys(current).filter((key) => !Object.is(current[key], previous[key]));
        if (keys.length > 0) {
          const seen = changed.get(thread.id) ?? new Set<string>();
          for (const key of keys) seen.add(key);
          changed.set(thread.id, seen);
        }
      }
      walk(node.child);
    }
  };
  // Only fibers on a path this commit cloned are visited: a subtree whose child pointer equals its
  // alternate's was reused whole, and its flags are left over from an earlier commit.
  const countRuns = (fiber: Fiber | null) => {
    for (let node = fiber; node; node = node.sibling) {
      const type = node.type as { name?: string } | null;
      if (
        typeof type === "function" &&
        type.name === "SortableThreadRow" &&
        node.alternate &&
        (node.flags & PERFORMED_WORK) !== 0
      ) {
        sortableRowRuns.count += 1;
      }
      if (!node.alternate || node.child !== node.alternate.child) countRuns(node.child);
    }
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
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        walk(root.current);
        countRuns(root.current);
      },
    },
  });
  return Object.assign(changed, { sortableRowRuns });
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

it("a route change re-renders only the thread rows whose open state changed, not the whole list", async () => {
  await page.viewport(1400, 900);
  const threads = Array.from({ length: 12 }, (_, index) => threadWithHistory(`row-${index}`, 1));
  using _environment = installFakeEnvironment(threads);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${threads[0]!.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });
  using _focus = { [Symbol.dispose]: startWorkspaceFocus(router) };
  await vi.waitFor(
    () => expect(document.querySelectorAll('[data-testid="sidebar-row-card"]').length).toBe(12),
    { timeout: 8000 },
  );
  await act(async () => {});

  const settle = async (check: () => void) => {
    await vi.waitFor(check, { timeout: 8000 });
    await act(async () => {});
  };
  const describeChanges = () =>
    Object.fromEntries([...rowRenders].map(([id, keys]) => [id, [...keys].sort()]));

  rowRenders.clear();
  await router.navigate({ to: "/settings/general" });
  await settle(() => expect(document.querySelector("[data-app-modal]")).not.toBeNull());
  expect(describeChanges(), "opening Settings: rows given new props").toEqual({});

  rowRenders.clear();
  router.history.back();
  await settle(() => expect(document.querySelector("[data-app-modal]")).toBeNull());
  expect(describeChanges(), "closing Settings: rows given new props").toEqual({});

  rowRenders.clear();
  rowRenders.sortableRowRuns.count = 0;
  await router.navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId: ENVIRONMENT_ID, threadId: threads[5]!.id },
  });
  await settle(() =>
    expect(router.state.location.pathname).toBe(`/${ENVIRONMENT_ID}/${threads[5]!.id}`),
  );
  expect(
    describeChanges(),
    "switching threads: only the row that closed and the row that opened get new props, and only their open state",
  ).toEqual({
    [threads[0]!.id]: ["isActive", "isRouteThread", "revealRef"],
    [threads[5]!.id]: ["isActive", "isRouteThread", "revealRef"],
  });
  expect(
    rowRenders.sortableRowRuns.count,
    "switching threads runs the sortable row function for the two rows that change, never for the whole list (12 rows)",
  ).toBeLessThanOrEqual(8);
});
