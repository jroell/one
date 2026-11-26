import { createMemoryHistory } from "@tanstack/react-router";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  TurnItemId,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily, and its first transform (React Compiler over ~4k lines)
// takes 6-11s; importing it here keeps that out of the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { setWorkspaceMode } from "~/one/workspaceMode";
import { getRouter } from "~/router";
import {
  CLAUDE_PROVIDER,
  CODEX_PROVIDER,
  ENVIRONMENT_ID,
  dispatchedCommands,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
  type FakeThread,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

function inChatMode(): Disposable {
  setWorkspaceMode("chat");
  return { [Symbol.dispose]: () => setWorkspaceMode("code") };
}

/** One question whose run stopped because the model's usage ran out. */
function threadStoppedOnUsageLimit(name: string): FakeThread {
  const history = threadWithHistory(name, 1);
  const stopped = { ...history.runs[0]!, status: "failed" as const };
  const at = DateTime.makeUnsafe("2026-03-17T19:12:28.000Z");
  // The thread kept its provider thread, so a model from another provider can take it over.
  const providerThread: OrchestrationV2ProviderThread = {
    id: ProviderThreadId.make(`${name}-provider-thread`),
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerSessionId: null,
    appThreadId: history.id,
    ownerNodeId: null,
    nativeThreadRef: null,
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: 1,
    lastRunOrdinal: 1,
    handoffIds: [],
    forkedFrom: null,
    pendingBackgroundTasks: [],
    nativeMetadata: null,
    goal: null,
    createdAt: at,
    updatedAt: at,
  };
  return {
    ...history,
    providerThreads: [providerThread],
    runs: [stopped],
    items: [
      history.items[0]!,
      {
        ...history.items[1]!,
        id: TurnItemId.make(`${name}-limit`),
        type: "error",
        status: "failed",
        failure: {
          class: "usage_limit",
          message: "You've hit your usage limit.",
          code: null,
          retryable: false,
          resetAt: "2099-11-30T16:46:00.000Z",
        },
      } as unknown as OrchestrationV2TurnItem,
    ],
  };
}

it("Chat mode says which model ran out of usage and what is ready, and Try again with it continues the stopped run on that model", async () => {
  using _mode = inChatMode();
  const thread = threadStoppedOnUsageLimit("usage-limit-chat");
  using _environment = installFakeEnvironment([thread], {
    acceptCommands: true,
    providers: [CODEX_PROVIDER, CLAUDE_PROVIDER],
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  const message = page.getByText(
    /GPT-5\.4 could not answer: its usage limit is reached until .+\. Claude is ready\./,
  );
  await expect.element(message).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Change model" })).toBeVisible();

  await page.getByRole("button", { name: "Try again with Claude" }).click();
  await vi.waitFor(() =>
    expect(dispatchedCommands()).toContainEqual(
      expect.objectContaining({
        manualContinuationOfRunId: thread.runs[0]!.id,
        modelSelection: expect.objectContaining({
          instanceId: "claudeAgent",
          model: "claude-opus-4-6",
        }),
      }),
    ),
  );
});

it("Code mode keeps the usage-limit strip and adds no message to the thread", async () => {
  const thread = threadStoppedOnUsageLimit("usage-limit-code");
  using _environment = installFakeEnvironment([thread], {
    acceptCommands: true,
    providers: [CODEX_PROVIDER, CLAUDE_PROVIDER],
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByText("Usage limit reached")).toBeVisible();
  expect(document.body.textContent).not.toContain("could not answer");
  expect(document.querySelector("[data-chat-usage-limit]")).toBeNull();
});
