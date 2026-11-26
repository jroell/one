import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily; importing it here keeps its first transform out of the test.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { waitForComposerSend } from "~/one/composerSendBridge";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  dispatchedCommands,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
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

const NOTES = "Explain the Providers page.";

async function openThread(name: string) {
  const thread = threadWithHistory(name, 1);
  const environment = installFakeEnvironment([thread], { acceptCommands: true, appNotes: false });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  const app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByText(`Answer 0 for ${thread.id}.`)).toBeVisible();
  const key = `${ENVIRONMENT_ID}:${thread.id}`;
  const bridge = await waitForComposerSend(key, 5_000);
  if (bridge === null) throw new Error("The composer never offered its send.");
  return {
    thread,
    bridge,
    key,
    [Symbol.asyncDispose]: async () => (
      await app[Symbol.asyncDispose]?.(),
      environment[Symbol.dispose]()
    ),
  };
}

const notesOf = (text: string) =>
  dispatchedCommands().flatMap((command) =>
    command.type === "message.dispatch" && command.text === text
      ? [command.context?.agentContext]
      : [],
  );

it("a guided send is refused, not sent without its notes, when the machine it would run on is too old to read them", async () => {
  await using opened = await openThread("app-send-old-server");
  const result = await opened.bridge.send({ text: "What is this?", agentContext: NOTES });
  expect(result).toEqual({
    ok: false,
    reason: "rejected",
    message: "This machine is too old to carry that question. Update it, then ask again.",
  });
  expect(notesOf("What is this?")).toEqual([]);
  expect(dispatchedCommands().some((command) => command.type === "message.dispatch")).toBe(false);
});
