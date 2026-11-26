import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { RuntimeRequestId } from "@t3tools/contracts";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { startWorkspaceFocus } from "~/lib/workspaceFocus";
import { getRouter } from "~/router";
import { useThreadSelectionStore } from "~/threadSelectionStore";
import { expect } from "vite-plus/test";
import {
  ENVIRONMENT_ID,
  emitShellUpdate,
  installFakeEnvironment,
  threadWithHistory,
} from "./fakeEnvironment";
import { render } from "./render";

import "~/index.css";

export async function openApp(path: string) {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  const app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  return { app, focus: { [Symbol.dispose]: startWorkspaceFocus(router) } };
}

export type Thread = ReturnType<typeof threadWithHistory>;

export const approvalRequest = (name: string) => ({
  id: RuntimeRequestId.make(`${name}-request`),
  kind: "command_approval" as const,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
});

export const rowOf = (thread: Thread) =>
  [...document.querySelectorAll<HTMLElement>('[data-testid="sidebar-row-card"]')].find((row) =>
    row.textContent?.includes(`Thread ${thread.id}`),
  )!;

/** The ids of the given threads, in the order the sidebar draws their rows. */
export const drawnOrder = (threads: readonly Thread[]) =>
  [...document.querySelectorAll<HTMLElement>('[data-testid="sidebar-row-card"]')].flatMap((row) => {
    const thread = threads.find((candidate) => row.textContent?.includes(`Thread ${candidate.id}`));
    return thread ? [thread.id] : [];
  });

/**
 * Three calm threads. The one listed last starts waiting on an approval, so the sidebar draws it
 * first, above the two that were listed before it.
 */
export async function openWithLastThreadWaiting(
  prefix: string,
  options?: Parameters<typeof installFakeEnvironment>[1],
) {
  // Each test names its own threads: the client keeps thread state for an id between tests in
  // one file, so a thread that waited in an earlier test would start out waiting in the next.
  useThreadSelectionStore.getState().clearSelection();
  await page.viewport(1400, 900);
  const threads = [
    threadWithHistory(`${prefix}-a`, 1),
    threadWithHistory(`${prefix}-b`, 1),
    threadWithHistory(`${prefix}-c`, 1),
  ];
  const environment = installFakeEnvironment(threads, options);
  const { app, focus } = await openApp(`/${ENVIRONMENT_ID}/${threads[0]!.id}`);
  await vi.waitFor(() => expect(drawnOrder(threads)).toHaveLength(3), { timeout: 8000 });
  const natural = drawnOrder(threads);
  const waiting = threads.find((thread) => thread.id === natural[2])!;
  const idle = natural.slice(0, 2).map((id) => threads.find((thread) => thread.id === id)!);
  await emitShellUpdate(waiting.id, {
    pendingRuntimeRequest: approvalRequest(waiting.id),
  } as never);
  await vi.waitFor(
    () => expect(document.querySelector("[data-sidebar-needs-you]")).not.toBeNull(),
    {
      timeout: 8000,
    },
  );
  // Drawn order is the waiting row, then the two rows in their old order.
  expect(drawnOrder(threads)).toEqual([waiting.id, idle[0]!.id, idle[1]!.id]);
  return {
    waiting,
    idle,
    [Symbol.asyncDispose]: async () => {
      await app[Symbol.asyncDispose]();
      focus[Symbol.dispose]();
      environment[Symbol.dispose]();
    },
  };
}
