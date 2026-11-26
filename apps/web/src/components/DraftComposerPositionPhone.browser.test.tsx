import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { ORCHESTRATION_V2_WS_METHODS, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";

import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { startWorkspaceFocus } from "~/lib/workspaceFocus";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  answerRpc,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

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

async function openApp(path: string) {
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
  return { app, router, focus: { [Symbol.dispose]: startWorkspaceFocus(router) } };
}

it("on a phone the composer sits in the same place on a new-thread draft and on an empty thread, bottom edge to bottom edge", async () => {
  await page.viewport(390, 844);
  const empty = threadWithHistory("empty-phone", 0);
  using _environment = installFakeEnvironment([empty]);
  const draftId = DraftId.make("draft-phone");
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, {
      threadId: ThreadId.make("thread-phone"),
    });
  const { app, focus, router } = await openApp(`/draft/${draftId}`);
  await using _app = app;
  using _focus = focus;
  const stack = () => document.querySelector<HTMLElement>('[data-chat-composer-stack="true"]')!;
  await expect.element(page.getByRole("heading", { name: "What are we building?" })).toBeVisible();
  const draftBox = stack().getBoundingClientRect();
  const draftStarters = document.querySelectorAll("[data-one-code-welcome] .one-chat-starters li");

  expect(Math.round(draftBox.bottom)).toBeGreaterThan(800);
  await router.navigate({ to: `/${ENVIRONMENT_ID}/${empty.id}` as never });
  await expect.element(page.getByRole("heading", { name: "What are we building?" })).toBeVisible();
  const threadBox = stack().getBoundingClientRect();
  // The draft opens expanded and the empty thread opens collapsed, so only their bottoms line up.
  expect(Math.round(threadBox.bottom)).toBe(Math.round(draftBox.bottom));
  expect(draftStarters.length).toBe(4);
});

it("on a phone a new-thread draft opens with its editor expanded and keeps it through the first send", async () => {
  await page.viewport(390, 844);
  using _environment = installFakeEnvironment([threadWithHistory("other-phone", 1)], {
    acceptCommands: true,
  });
  const launches: unknown[] = [];
  using _launch = answerRpc(ORCHESTRATION_V2_WS_METHODS.launchThread, (input) => {
    launches.push(input);
    return Effect.never;
  });
  const draftId = DraftId.make("draft-expanded");
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, {
      threadId: ThreadId.make("thread-expanded"),
    });
  const { app, focus } = await openApp(`/draft/${draftId}`);
  await using _app = app;
  using _focus = focus;
  await expect.element(page.getByRole("heading", { name: "What are we building?" })).toBeVisible();

  // The composer is already open: no collapsed bar to tap first.
  expect(page.getByRole("button", { name: "Expand composer" }).elements()).toHaveLength(0);
  const editor = page.getByTestId("composer-editor");
  await expect.element(editor).toBeVisible();

  await userEvent.click(editor);
  await userEvent.keyboard("first message");
  // The send needs the project, which arrives with the shell snapshot: send again until it goes.
  await vi.waitFor(
    async () => {
      if (launches.length === 0) await userEvent.keyboard("{Enter}");
      expect(launches).toHaveLength(1);
    },
    { timeout: 12000, interval: 600 },
  );
  // The send leaves the composer open and ready for the next message.
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  expect(page.getByRole("button", { name: "Expand composer" }).elements()).toHaveLength(0);
});
