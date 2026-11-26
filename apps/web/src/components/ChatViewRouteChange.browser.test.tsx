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

// React reports each commit to a DevTools hook installed before it loads. The hook counts how many
// times the chat view rendered.
const chatViewRenders = vi.hoisted(() => {
  const counter = { count: 0 };
  interface Fiber {
    child: Fiber | null;
    sibling: Fiber | null;
    alternate: Fiber | null;
    flags: number;
    type: unknown;
  }
  const PERFORMED_WORK = 1;
  // A fiber left untouched by a commit keeps the flags of its last render, so count only fibers
  // that were not in the previous commit's tree.
  let previous = new WeakSet<object>();
  const walk = (root: Fiber) => {
    const current = new WeakSet<object>();
    const visit = (fiber: Fiber | null) => {
      for (let node = fiber; node; node = node.sibling) {
        current.add(node);
        const type = node.type as { name?: string } | null;
        if (
          typeof type === "function" &&
          type.name === "ChatView" &&
          !previous.has(node) &&
          node.alternate !== null &&
          (node.flags & PERFORMED_WORK) !== 0
        ) {
          counter.count += 1;
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
  return counter;
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

it("opening, changing a page in, and closing Settings does not render the chat view behind it", async () => {
  await page.viewport(1400, 900);
  const threads = [threadWithHistory("open-thread", 2)];
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
    () => expect(document.querySelector(".messages-timeline-scroll")).not.toBeNull(),
    {
      timeout: 8000,
    },
  );
  await act(async () => {});

  const settle = async (check: () => void) => {
    await vi.waitFor(check, { timeout: 8000 });
    await act(async () => {});
  };

  chatViewRenders.count = 0;
  await router.navigate({ to: "/settings/general" });
  await settle(() => expect(document.querySelector("[data-app-modal]")).not.toBeNull());
  expect(chatViewRenders.count, "opening Settings").toBe(0);

  await router.navigate({ to: "/settings/appearance" });
  await settle(() => expect(router.state.location.pathname).toBe("/settings/appearance"));
  expect(chatViewRenders.count, "changing the page inside Settings").toBe(0);

  router.history.back();
  await settle(() => expect(router.state.location.pathname).toBe("/settings/general"));
  router.history.back();
  await settle(() => expect(document.querySelector("[data-app-modal]")).toBeNull());
  expect(chatViewRenders.count, "closing Settings").toBe(0);
});
