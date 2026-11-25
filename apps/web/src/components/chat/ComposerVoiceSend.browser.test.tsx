import { createMemoryHistory } from "@tanstack/react-router";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { ProviderInstanceId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily, and its first transform takes seconds; import it here.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getVoiceBridge } from "~/one/voiceBridge";
import { getRouter } from "~/router";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { draftFanoutSelectionsAtom } from "./chatViewSend";
import {
  ENVIRONMENT_ID,
  dispatchedCommands,
  emitThreadEvent,
  installFakeEnvironment,
  isThreadSubscribed,
  runningRun,
  threadWithHistory,
  userItem,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { act, render } from "../../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

/** The thread view the way voice chat finds it: the real composer, with the spoken words typed in. */
async function openThread(name: string, followUpBehavior: "queue" | "steer") {
  const thread = threadWithHistory(name, 1);
  const environment = installFakeEnvironment([thread], { acceptCommands: true });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    followUpBehavior,
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
  return {
    thread,
    [Symbol.asyncDispose]: async () => {
      await app[Symbol.asyncDispose]();
      environment[Symbol.dispose]();
    },
  };
}

function dispatchedMessages() {
  return dispatchedCommands().flatMap((command) =>
    command.type === "message.dispatch"
      ? [
          {
            messageId: command.messageId,
            text: command.text,
            mode: command.dispatchMode.type,
            delivery: command.deliveryIntent,
          },
        ]
      : [],
  );
}

async function speak(words: string) {
  const editor = page.getByTestId("composer-editor");
  await userEvent.click(editor);
  await userEvent.type(editor, words);
  const bridge = getVoiceBridge();
  if (bridge === null) throw new Error("The main composer published no voice controls");
  const onSent = vi.fn<(messageId: string) => void>();
  bridge.submit(onSent);
  return onSent;
}

it("voice chat learns the id of the message the composer sends to an idle thread", async () => {
  await using _app = await openThread("voice-idle", "queue");

  const onSent = await speak("why is the sky blue");

  await vi.waitFor(() => expect(dispatchedMessages()).toHaveLength(1));
  const [sent] = dispatchedMessages();
  expect(sent).toMatchObject({ text: "why is the sky blue", mode: "start_immediately" });
  expect(onSent).toHaveBeenCalledExactlyOnceWith(sent!.messageId);
});

it.each([
  { behavior: "queue", verb: "queues behind" },
  { behavior: "steer", verb: "steers into" },
] as const)(
  "voice chat learns the id of the message the composer $verb a running turn",
  async ({ behavior }) => {
    await using app = await openThread(`voice-${behavior}`, behavior);
    await vi.waitFor(() => expect(isThreadSubscribed(app.thread.id)).toBe(true));
    const live = runningRun(
      app.thread.id,
      `voice-${behavior}-live`,
      2,
      `voice-${behavior}-live-user`,
    );
    await act(async () => {
      await emitThreadEvent(app.thread.id, { type: "run.created", payload: live });
      await emitThreadEvent(app.thread.id, {
        type: "turn-item.updated",
        payload: userItem(app.thread.id, live.id, `voice-${behavior}-live-user`, 2, "Keep going"),
      });
    });
    await expect.element(page.getByText("Keep going", { exact: true })).toBeVisible();

    const onSent = await speak("and the sunset");

    await vi.waitFor(() => expect(dispatchedMessages()).toHaveLength(1));
    const [sent] = dispatchedMessages();
    expect(sent).toMatchObject(
      behavior === "queue"
        ? { text: "and the sunset", mode: "queue_after_active" }
        : { text: "and the sunset", mode: "start_immediately", delivery: "steer" },
    );
    expect(onSent).toHaveBeenCalledExactlyOnceWith(sent!.messageId);
  },
);

it("voice chat is told nothing when the composer ends the send before any turn request goes out", async () => {
  await using _app = await openThread("voice-empty", "queue");
  const editor = page.getByTestId("composer-editor");
  await userEvent.click(editor);
  const bridge = getVoiceBridge();
  if (bridge === null) throw new Error("The main composer published no voice controls");
  const onSent = vi.fn<(messageId: string) => void>();

  // Nothing was dictated, so the draft is empty and the composer sends nothing.
  bridge.submit(onSent);
  await vi.waitFor(() => expect(editor.element()).toBeVisible());

  expect(dispatchedMessages()).toEqual([]);
  expect(onSent).not.toHaveBeenCalled();
});

it("voice chat is not offered while the composer would fan the question out to several models", async () => {
  await using app = await openThread("voice-fanout", "queue");
  await vi.waitFor(() => expect(getVoiceBridge()?.available).toBe(true));
  const selections = draftFanoutSelectionsAtom(
    scopedThreadKey(scopeThreadRef(ENVIRONMENT_ID, app.thread.id)),
  );

  await act(() => {
    appAtomRegistry.set(selections, [
      { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4-mini" },
    ]);
  });
  await vi.waitFor(() => expect(getVoiceBridge()?.available).toBe(false));

  await act(() => {
    appAtomRegistry.set(selections, null);
  });
  await vi.waitFor(() => expect(getVoiceBridge()?.available).toBe(true));
});
