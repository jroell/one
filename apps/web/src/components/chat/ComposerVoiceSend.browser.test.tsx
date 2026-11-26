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
import { getVoiceBridge, type VoiceSendReport } from "~/one/voiceBridge";
import { getRouter } from "~/router";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { draftFanoutSelectionsAtom } from "./chatViewSend";
import {
  ENVIRONMENT_ID,
  dispatchedCommands,
  rejectPendingCommand,
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

// The microphone and its transcription are the faked boundary: while a test has dictation under way,
// the composer is handed the queue a real dictation session would own. Everything else stays real.
const dictation = vi.hoisted(() => ({
  active: false,
  queued: null as null | { submit: (text: string) => void; dropped: (() => void) | undefined },
}));
vi.mock(import("../../speech/useEnvironmentSpeechInput"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useEnvironmentSpeechInput: ((input) => {
      const real = actual.useEnvironmentSpeechInput(input);
      return dictation.active
        ? {
            ...real,
            blocksSubmission: true,
            submitAfterDictation: (submit, dropped) =>
              void (dictation.queued = { submit, dropped }),
          }
        : real;
    }) as typeof actual.useEnvironmentSpeechInput,
  };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

/** The thread view the way voice chat finds it: the real composer, with the spoken words typed in. */
async function openThread(
  name: string,
  followUpBehavior: "queue" | "steer",
  holdTurnRequests = false,
) {
  const thread = threadWithHistory(name, 1);
  const environment = installFakeEnvironment([thread], {
    acceptCommands: true,
    holdCommand: (command) => holdTurnRequests && command.type === "message.dispatch",
  });
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

/** A report that records which call the composer made, so a test waits for the composer's own answer. */
function voiceReport(): VoiceSendReport & { readonly calls: Array<readonly [string, unknown]> } {
  const calls: Array<readonly [string, unknown]> = [];
  return {
    calls,
    sent: (messageId) => void calls.push(["sent", messageId]),
    rejected: (message) => void calls.push(["rejected", message]),
    notSent: (destination) => void calls.push(["notSent", destination]),
  };
}

async function speak(words: string) {
  const editor = page.getByTestId("composer-editor");
  await userEvent.click(editor);
  if (words !== "") await userEvent.type(editor, words);
  return submitVoice();
}

function submitVoice() {
  const bridge = getVoiceBridge();
  if (bridge === null) throw new Error("The main composer published no voice controls");
  const report = voiceReport();
  bridge.submit(report);
  return report;
}

it("voice chat learns the id of the message the composer sends to an idle thread", async () => {
  await using _app = await openThread("voice-idle", "queue");

  const report = await speak("why is the sky blue");

  await vi.waitFor(() => expect(dispatchedMessages()).toHaveLength(1));
  const [sent] = dispatchedMessages();
  expect(sent).toMatchObject({ text: "why is the sky blue", mode: "start_immediately" });
  expect(report.calls).toEqual([["sent", sent!.messageId]]);
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

    const report = await speak("and the sunset");

    await vi.waitFor(() => expect(dispatchedMessages()).toHaveLength(1));
    const [sent] = dispatchedMessages();
    expect(sent).toMatchObject(
      behavior === "queue"
        ? { text: "and the sunset", mode: "queue_after_active" }
        : { text: "and the sunset", mode: "start_immediately", delivery: "steer" },
    );
    expect(report.calls).toEqual([["sent", sent!.messageId]]);
  },
);

it("voice chat is told the composer sent nothing when the draft is empty", async () => {
  await using _app = await openThread("voice-empty", "queue");

  const report = await speak("");

  await vi.waitFor(() => expect(report.calls).toEqual([["notSent", "none"]]));
  expect(dispatchedMessages()).toEqual([]);
});

/** The person is still dictating when voice chat asks the composer to send what they say. */
function dictating(): Disposable {
  dictation.active = true;
  dictation.queued = null;
  return {
    [Symbol.dispose]() {
      dictation.active = false;
      dictation.queued = null;
    },
  };
}

it("voice chat is told the composer sent nothing when the dictation it was waiting on ended with no text", async () => {
  using _dictation = dictating();
  await using _app = await openThread("voice-dictation-empty", "queue");

  const report = await speak("");
  // The composer waits for the dictation to hand over a transcript before it sends anything.
  expect(report.calls).toEqual([]);
  expect(dictation.queued).not.toBeNull();

  // The dictation ended in "No speech was detected": the session drops the queued send.
  dictation.queued?.dropped?.();

  expect(report.calls).toEqual([["notSent", "none"]]);
  expect(dispatchedMessages()).toEqual([]);
});

it("voice chat is told when the server refuses the turn request, after it learned the id", async () => {
  await using _app = await openThread("voice-refused", "queue", true);

  const report = await speak("why is the sky blue");
  await vi.waitFor(() => expect(dispatchedMessages()).toHaveLength(1));
  await rejectPendingCommand("Attachment 'sample.png' cannot be sent.");

  await vi.waitFor(() => expect(report.calls).toHaveLength(2));
  expect(report.calls).toEqual([
    ["sent", dispatchedMessages()[0]!.messageId],
    ["rejected", expect.stringContaining("Attachment 'sample.png' cannot be sent.")],
  ]);
});

it("voice chat is told when the question became a side chat, with no turn request for its thread", async () => {
  await page.viewport(1400, 900);
  await using _app = await openThread("voice-side", "queue");

  const report = await speak("/side what is this?");

  await vi.waitFor(() => expect(report.calls).toEqual([["notSent", "side-chat"]]));
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
