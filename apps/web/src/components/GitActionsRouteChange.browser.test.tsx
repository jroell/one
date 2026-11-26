// First, so the render counter's DevTools hook exists before react-dom loads.
import { commitsSoFar, startCounting, stopCounting } from "../../test/renderCounter";
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
  emitVcsStatus,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";

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

const local = (insertions: number) => ({
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: true,
  refName: "main",
  hasWorkingTreeChanges: true,
  workingTree: {
    files: [{ path: "src/app.ts", insertions, deletions: 0 }],
    insertions,
    deletions: 0,
  },
});

it("opening and closing Settings and changing a Settings page render the git control zero times, and switching to another thread renders it", async () => {
  await page.viewport(1400, 900);
  const thread = threadWithHistory("git-route", 2);
  const other = threadWithHistory("git-route-other", 2);
  using _environment = installFakeEnvironment([thread, other]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });
  using _focus = { [Symbol.dispose]: startWorkspaceFocus(router) };
  await vi.waitFor(() => expect(document.querySelector("[data-sidebar-row]")).not.toBeNull(), {
    timeout: 8000,
  });
  await act(() => emitVcsStatus({ _tag: "snapshot", local: local(0), remote: null }));
  // The control is on the page.
  await expect.element(page.getByRole("button", { name: "Git action options" })).toBeVisible();

  const settle = async () => {
    let seen = -1;
    await vi.waitFor(
      () => {
        const now = commitsSoFar();
        const settled = now === seen;
        seen = now;
        expect(settled).toBe(true);
      },
      { interval: 100, timeout: 15_000 },
    );
  };
  const count = async (action: () => Promise<void>) => {
    await settle();
    startCounting();
    await action();
    await settle();
    const report = stopCounting();
    return report.components.CheckoutGitActionsControl ?? 0;
  };

  expect(
    await count(async () => {
      await act(() => router.navigate({ to: "/settings/general" }));
      await vi.waitFor(() => expect(document.querySelector("[data-app-modal]")).not.toBeNull());
    }),
    "opening Settings",
  ).toBe(0);
  expect(
    await count(async () => {
      await act(() => router.navigate({ to: "/settings/appearance" }));
      await vi.waitFor(() => expect(router.state.location.pathname).toBe("/settings/appearance"));
    }),
    "changing the Settings page",
  ).toBe(0);
  expect(
    await count(async () => {
      router.history.back();
      router.history.back();
      await vi.waitFor(() => expect(document.querySelector("[data-app-modal]")).toBeNull());
    }),
    "closing Settings",
  ).toBe(0);
  expect(
    await count(async () => {
      await act(() =>
        router.navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: ENVIRONMENT_ID, threadId: other.id },
        }),
      );
      await vi.waitFor(() =>
        expect(router.state.location.pathname).toBe(`/${ENVIRONMENT_ID}/${other.id}`),
      );
    }),
    "switching to another thread",
  ).toBeGreaterThan(0);
});
