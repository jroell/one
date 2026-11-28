import type { ScopedThreadRef } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, fakeTimers, render, stubGlobal } from "../../test/render";
import { ToastProvider, toastManager } from "../components/ui/toast";
import { OneVoiceStage, type VoiceStageMessage } from "./OneVoiceStage";
import { startVoiceChat } from "./startVoiceChat";
import {
  commitVoiceThread,
  getVoiceBridge,
  publishVoiceBridge,
  retractVoiceBridge,
  voiceLevel,
  type VoiceSendReport,
} from "./voiceBridge";
import { getVoiceChatStyle, setVoiceChatStyle, useVoiceChatStyle } from "./voiceChatPreferences";
import {
  dispatchVoiceSession,
  getVoiceSession,
  speechDeadlineMs,
  type VoiceStartResult,
} from "./voiceSession";
import { setWorkspaceMode } from "./workspaceMode";

// The ring is a WebGL picture the stage only hands a state to. Under a fake clock every fake frame
// would draw it for real, which made the 60 second waits below take 30 seconds of real time.
vi.mock(import("./OneOrb"), async (original) => ({
  ...(await original()),
  OneOrb: (({ state }: { readonly state?: string }) => <div data-one-orb={state} />) as never,
}));

const saved = vi.hoisted(() => ({
  /** The thread's sync status; only "live" means the connection delivers what the server does. */
  status: "live" as "live" | "synchronizing" | "cached",
  rows: [] as ReadonlyArray<unknown>,
  runs: [] as ReadonlyArray<{
    id: string;
    userMessageId: string;
    status: string;
    queueHeld?: boolean;
  }>,
}));
// A saved thread's turn items come from the app's state; the test supplies them directly.
vi.mock(import("../state/entities"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useThreadVisibleTurnItems: ((ref: ScopedThreadRef | null) =>
      ref === null ? actual.useThreadVisibleTurnItems(null) : saved.rows) as never,
    useThreadStatus: ((ref: ScopedThreadRef | null) =>
      ref === null ? actual.useThreadStatus(null) : saved.status) as never,
    useQuietThreadProjection: ((ref: ScopedThreadRef | null) =>
      ref === null
        ? actual.useQuietThreadProjection(null)
        : { environmentId: "env-1", projection: { runs: saved.runs } }) as never,
  };
});
const SAVED_THREAD = { environmentId: "env-1", threadId: "thread-a" } as unknown as ScopedThreadRef;

const OLD_REPLY: VoiceStageMessage = {
  id: "a1",
  role: "assistant",
  text: "An older answer.",
  streaming: false,
};
const NEW_REPLY: VoiceStageMessage = {
  id: "a2",
  role: "assistant",
  text: "Light **bends** inside each drop.\n```js\nrefract()\n```",
  streaming: false,
};

/** What voice chat says for NEW_REPLY: its code block is left in the thread. */
const NEW_REPLY_SPOKEN = "Light bends inside each drop.\nThe code is in the thread.";

const QUESTION: VoiceStageMessage = {
  id: "u2",
  role: "user",
  text: "why is the sky blue",
  streaming: false,
};

type MicrophonePhase =
  | "idle"
  | "preparing"
  | "recording"
  | "transcribing"
  | "post-processing"
  | "error";

/** Stands in for the main composer's dictation: the microphone is the boundary being faked. */
function setup() {
  saved.status = "live";
  saved.rows = [];
  saved.runs = [];
  const microphone = {
    phase: "idle" as MicrophonePhase,
    threadKey: "thread-a",
    isDraft: false,
    promotedFrom: null as string | null,
    draftEmpty: true,
    recordings: 0,
    submits: 0,
    available: true,
    needsSetup: false,
    /** How many times the person pressed a notice's "Open Voice settings". */
    setupOpened: 0,
    error: null as string | null,
    /** A start that was requested and has not begun recording (the permission prompt is open). */
    pendingStart: false,
    /** Told the message id when the composer sends the transcript; the real composer's own send is tested with the app. */
    report: null as VoiceSendReport | null,
    holdStarts: false,
    /** The start waits on a speech status check that has not answered yet; the recorder reports idle. */
    pendingStatus: null as AbortSignal | null,
    holdStatus: false,
    /** The signal each start was given. */
    signals: [] as Array<AbortSignal | undefined>,
    /** Starts end straight back in the error they were retried from. */
    failStarts: false,
  };
  const waiting = () => new Promise<VoiceStartResult>(() => undefined);
  const continues = (draftKey: string) => microphone.promotedFrom === draftKey;
  const publish = () => {
    // The real composer commits its thread in a layout effect, then publishes its controls.
    commitVoiceThread("test", microphone.threadKey, continues);
    publishVoiceBridge("test", {
      threadKey: microphone.threadKey,
      isDraft: microphone.isDraft,
      continuesDraft: continues,
      available: microphone.available,
      needsSetup: microphone.needsSetup,
      openSetup: () => {
        microphone.setupOpened += 1;
      },
      draftEmpty: microphone.draftEmpty,
      phase: microphone.phase,
      error: microphone.error,
      heard: microphone.phase === "recording" ? "why is the sky blue" : "",
      start: (signal) => {
        microphone.signals.push(signal);
        if (microphone.holdStarts) {
          // Like the real recorder while the permission prompt is open.
          microphone.pendingStart = true;
          microphone.phase = "preparing";
          publish();
          return waiting();
        }
        if (microphone.holdStatus) {
          microphone.pendingStatus = signal ?? null;
          return waiting();
        }
        if (microphone.failStarts) {
          microphone.error = "Could not start voice recording.";
          microphone.phase = "error";
          publish();
          return Promise.resolve("failed");
        }
        microphone.error = null;
        microphone.phase = "recording";
        microphone.recordings += 1;
        publish();
        return Promise.resolve("started");
      },
      submit: (report) => {
        microphone.submits += 1;
        microphone.report = report;
        microphone.phase = "transcribing";
        publish();
      },
      cancel: () => {
        microphone.pendingStart = false;
        microphone.error = null;
        microphone.phase = "idle";
        publish();
      },
    });
  };
  setWorkspaceMode("chat");
  publish();
  const spoken: SpeechSynthesisUtterance[] = [];
  return {
    microphone,
    spoken,
    /** The transcript arrived and the composer sent it under `messageId`, as it does after dictation. */
    finishTranscribing: (messageId: string = QUESTION.id) =>
      act(() => {
        microphone.report?.sent(messageId);
        microphone.phase = "idle";
        publish();
      }),
    /** The composer finished dictation without a request: it reports how the send ended instead. */
    endSend: (end: (report: VoiceSendReport) => void) =>
      act(() => {
        if (microphone.report) end(microphone.report);
        microphone.phase = "idle";
        publish();
      }),
    /** The recorder moves to another phase of the same send, such as cleaning the transcript up. */
    movePhase: (phase: MicrophonePhase) =>
      act(() => {
        microphone.phase = phase;
        publish();
      }),
    /** Every start from now on fails straight back with the same error. */
    failStartsFromNow: () => {
      microphone.failStarts = true;
    },
    moveComposerTo: (threadKey: string, promotedFrom: string | null = null) =>
      act(() => {
        microphone.threadKey = threadKey;
        microphone.isDraft = false;
        microphone.promotedFrom = promotedFrom;
        publish();
      }),
    holdStartPending: () => {
      microphone.holdStarts = true;
    },
    /** The speech status check has not answered, so a start is waiting before it opens the microphone. */
    holdStatusCheck: () => {
      microphone.holdStatus = true;
    },
    /** The status check answered "ready": a start that was not abandoned opens the microphone. */
    resolveStatusCheck: () =>
      act(() => {
        const signal = microphone.pendingStatus;
        microphone.pendingStatus = null;
        microphone.holdStatus = false;
        if (signal?.aborted !== false) return;
        microphone.phase = "recording";
        microphone.recordings += 1;
        publish();
      }),
    /** No transcription source is chosen: starting opens Voice settings. */
    needSetup: () => {
      microphone.needsSetup = true;
      publish();
    },
    setAvailable: (available: boolean) =>
      act(() => {
        microphone.available = available;
        publish();
      }),
    failRecording: () =>
      act(() => {
        microphone.error = "Could not start voice recording.";
        microphone.phase = "error";
        publish();
      }),
    /** Voice chat moves to a thread the composer has not published controls for yet. */
    commitThreadOnly: (threadKey: string) =>
      act(() => {
        microphone.threadKey = threadKey;
        commitVoiceThread("test", threadKey, continues);
      }),

    startOrdinaryDictation: () =>
      act(() => {
        microphone.phase = "recording";
        publish();
      }),
    startInDraft: () =>
      act(() => {
        microphone.threadKey = "draft-1";
        microphone.isDraft = true;
        publish();
        dispatchVoiceSession({ type: "start", threadKey: "draft-1", isDraft: true });
      }),
    stage: (
      isWorking: boolean,
      messages: ReadonlyArray<VoiceStageMessage>,
      needsUser = false,
      threadRef: ScopedThreadRef | null = null,
    ) => (
      <OneVoiceStage
        threadRef={threadRef}
        isWorking={isWorking}
        needsUser={needsUser}
        draftMessages={messages}
      />
    ),
    start: () => act(() => dispatchVoiceSession({ type: "start", threadKey: "thread-a" })),
    [Symbol.dispose]() {
      dispatchVoiceSession({ type: "stop" });
      retractVoiceBridge("test");
      setWorkspaceMode("code");
    },
  };
}

/** Clicks in the page itself: a fake frame clock stalls the browser driver's click, which waits on frames. */
function press(button: { element(): Element }) {
  return act(() => {
    const element = button.element();
    if (element instanceof HTMLElement) element.click();
  });
}

const NO_ROUTER = { router: false /* voice chat does not navigate */ } as const;

it("voice chat sends the spoken question, reads only the new reply aloud, then records again", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));

  await voice.start();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Listening");
  await expect.element(screen.getByText("why is the sky blue")).toBeVisible();

  await screen.getByRole("button", { name: "Send what I said" }).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Thinking");
  expect(voice.microphone.phase).toBe("transcribing");

  await voice.finishTranscribing();
  await screen.rerender(voice.stage(true, [OLD_REPLY]));
  await screen.rerender(voice.stage(false, [OLD_REPLY, QUESTION, NEW_REPLY]));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  expect(stageOf(screen).querySelector(".one-voice-caption")?.textContent).toBe(NEW_REPLY_SPOKEN);
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([NEW_REPLY_SPOKEN]);

  await act(() => voice.spoken[0]?.onend?.(new Event("end") as SpeechSynthesisEvent));
  await expect.element(screen.getByText("why is the sky blue")).toBeVisible();
  expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 2 });
});

it("voice chat reads nothing of a streaming reply before its first sentence is finished, then reads it once, in full", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));

  await voice.start();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(true, []));
  await screen.rerender(
    voice.stage(false, [QUESTION, { ...NEW_REPLY, text: "Light **bends**", streaming: true }]),
  );
  await expect.element(screen.getByRole("status")).toHaveTextContent("Thinking");
  expect(voice.spoken).toEqual([]);

  await screen.rerender(voice.stage(false, [QUESTION, NEW_REPLY]));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([NEW_REPLY_SPOKEN]);
});

it("voice chat starts reading a reply while the agent is still writing it, reads the rest as it arrives, and listens again only after the last part", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  const writing = (text: string) => ({ ...NEW_REPLY, text, streaming: true });
  const said = () => voice.spoken.map((utterance) => utterance.text);
  const finish = (index: number) =>
    act(() => voice.spoken[index]?.onend?.(new Event("end") as SpeechSynthesisEvent));

  await voice.start();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(true, [QUESTION]));
  await screen.rerender(
    voice.stage(true, [QUESTION, writing("Light bends inside each drop. The rest is still")]),
  );
  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  expect(said()).toEqual(["Light bends inside each drop."]);

  // The first part is read before the agent has written more: voice chat waits, it does not listen.
  await finish(0);
  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  expect(voice.microphone.recordings).toBe(1);

  await screen.rerender(
    voice.stage(true, [
      QUESTION,
      writing("Light bends inside each drop. The rest is still coming.\nAnd"),
    ]),
  );
  await vi.waitFor(() =>
    expect(said()).toEqual(["Light bends inside each drop.", "The rest is still coming."]),
  );

  await screen.rerender(
    voice.stage(false, [
      QUESTION,
      { ...NEW_REPLY, text: "Light bends inside each drop. The rest is still coming.\nAnd done." },
    ]),
  );
  await finish(1);
  await vi.waitFor(() => expect(said().at(-1)).toBe("And done."));
  expect(said()).toHaveLength(3);
  expect(voice.microphone.recordings).toBe(1);

  await finish(2);
  await vi.waitFor(() =>
    expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 2 }),
  );
});

it("voice chat reads a later answer of the same turn after the first one, without reading the first again", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  const said = () => voice.spoken.map((utterance) => utterance.text);
  const finish = (index: number) =>
    act(() => voice.spoken[index]?.onend?.(new Event("end") as SpeechSynthesisEvent));
  const first: VoiceStageMessage = {
    id: "a2",
    role: "assistant",
    text: "Let me look at the code first.",
    streaming: false,
  };
  const later: VoiceStageMessage = {
    id: "a3",
    role: "assistant",
    text: "It keeps the answer in a cache for an hour.",
    streaming: false,
  };

  await voice.start();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(true, [QUESTION]));
  await screen.rerender(voice.stage(true, [QUESTION, first]));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  expect(said()).toEqual([first.text]);

  await finish(0);
  await screen.rerender(voice.stage(true, [QUESTION, first, later]));
  await vi.waitFor(() => expect(said()).toEqual([first.text, later.text]));

  await screen.rerender(voice.stage(false, [QUESTION, first, later]));
  await finish(1);
  await vi.waitFor(() =>
    expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 2 }),
  );
  expect(said()).toEqual([first.text, later.text]);
});

it("voice chat closes and releases the microphone when the composer moves to another thread", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);

  await voice.start();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Listening");

  await voice.moveComposerTo("thread-b");
  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).not.toBeInTheDocument();
  expect(voice.microphone.phase).toBe("idle");
});

it("voice chat started in a new thread stays open when the first question turns the draft into a saved thread", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));

  await voice.startInDraft();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing();
  await voice.moveComposerTo("env:thread-9", "draft-1");
  await screen.rerender(voice.stage(true, []));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Thinking");

  await screen.rerender(voice.stage(false, [QUESTION, NEW_REPLY]));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
});

it("voice chat started in a new thread closes when another saved thread is opened before the reply", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);

  await voice.startInDraft();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing();
  await voice.moveComposerTo("env:some-other-thread");

  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).not.toBeInTheDocument();
});

it("ending voice chat while the microphone is still starting stops that start", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  // The permission prompt is open: the recorder has been asked to start but is not recording yet.
  voice.holdStartPending();

  await voice.start();
  await screen.getByRole("button", { name: "End voice chat" }).click();

  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).not.toBeInTheDocument();
  expect(voice.microphone).toMatchObject({ pendingStart: false, phase: "idle" });
});

it("ending voice chat after its own microphone start failed leaves a dictation started afterwards running", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);

  await voice.start();
  // Voice chat's recording fails, then someone starts ordinary dictation.
  await voice.failRecording();
  await voice.startOrdinaryDictation();

  await screen.getByRole("button", { name: "End voice chat" }).click();
  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).not.toBeInTheDocument();
  expect(voice.microphone.phase).toBe("recording");
});

it("ending voice chat leaves a dictation started later with the ordinary shortcut running", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);

  await voice.start();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(true, []));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Thinking");
  // Someone starts ordinary dictation while the agent thinks.
  await voice.startOrdinaryDictation();

  await screen.getByRole("button", { name: "End voice chat" }).click();
  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).not.toBeInTheDocument();
  expect(voice.microphone.phase).toBe("recording");
});

it("voice chat closes and releases the microphone when its screen goes away", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);

  await voice.start();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Listening");

  await screen.unmount();
  await expect.poll(() => voice.microphone.phase).toBe("idle");
});

it("voice chat steps aside when the turn needs an approval", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);

  await voice.start();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(true, [], true));

  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).not.toBeInTheDocument();
});

it("ending voice chat closes it and releases the microphone", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);

  await voice.start();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Listening");
  expect(voice.microphone.phase).toBe("recording");

  await screen.getByRole("button", { name: "End voice chat" }).click();
  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).not.toBeInTheDocument();
  expect(voice.microphone.phase).toBe("idle");
});

it("ending voice chat after a failed microphone start and a retry cancels the retried recording", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);

  await voice.start();
  await voice.failRecording();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Voice input stopped");

  await screen.getByRole("button", { name: "Try the microphone again" }).click();
  expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 2 });

  await screen.getByRole("button", { name: "End voice chat" }).click();
  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).not.toBeInTheDocument();
  expect(voice.microphone.phase).toBe("idle");
});

it("a microphone start still waiting on its status check is abandoned when voice chat closes, so it never opens the microphone", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _timers = fakeTimers();
  voice.holdStatusCheck();

  await voice.start();
  expect(voice.microphone.signals).toHaveLength(1);
  // The status check is slow: the recorder still reports idle, so voice chat gives up and closes.
  await act(() => vi.advanceTimersByTime(2_500));
  expect(screen.getByRole("dialog", { name: "Voice chat" }).query()).toBeNull();
  expect(voice.microphone.signals[0]?.aborted).toBe(true);

  // The check finally answers "ready"; the start it belongs to must not record.
  await voice.resolveStatusCheck();
  expect(voice.microphone).toMatchObject({ phase: "idle", recordings: 0 });
});

it("a spoken question queued before the composer changed thread is not sent to the new thread", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);

  await voice.start();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Listening");
  // The new thread is committed, but its controls are not published yet.
  await voice.commitThreadOnly("thread-b");

  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).not.toBeInTheDocument();
  expect(voice.microphone.submits).toBe(0);
  expect(voice.microphone.phase).toBe("idle");
});

it("a finished reply seen without any frame showing the thread working is read aloud once", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));

  await voice.start();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(false, [OLD_REPLY, QUESTION, NEW_REPLY]));

  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([NEW_REPLY_SPOKEN]);
});

it("a later message in the conversation does not restart or replace the reply being read", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));

  await voice.start();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(true, [OLD_REPLY, QUESTION]));
  await screen.rerender(voice.stage(false, [OLD_REPLY, QUESTION, NEW_REPLY]));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");

  // A queued follow-up gets its own answer while the first one is still being read.
  const followUp: VoiceStageMessage = { ...QUESTION, id: "u3" };
  const laterAnswer: VoiceStageMessage = { ...NEW_REPLY, id: "a3", text: "A different answer." };
  await screen.rerender(
    voice.stage(false, [OLD_REPLY, QUESTION, NEW_REPLY, followUp, laterAnswer]),
  );

  expect(stageOf(screen).querySelector(".one-voice-caption")?.textContent).toBe(NEW_REPLY_SPOKEN);
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([NEW_REPLY_SPOKEN]);
});

it("voice chat shows that voice input is unavailable when the destination is lost while the agent answers, then closes with a notice", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(true, [OLD_REPLY, QUESTION]));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Thinking");
  await voice.setAvailable(false);

  await screen.rerender(voice.stage(false, [OLD_REPLY, QUESTION, NEW_REPLY]));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  using _timers = fakeTimers();
  await act(() => voice.spoken[0]?.onend?.(new Event("end") as SpeechSynthesisEvent));
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Voice input is not available");

  await act(() => vi.advanceTimersByTime(2_499));
  expect(screen.getByRole("dialog", { name: "Voice chat" }).element()).toBeInTheDocument();
  await act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("dialog", { name: "Voice chat" }).query()).toBeNull();
});

it("voice chat gives up on a question stuck in transcription after 60 seconds and offers to try again", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  // The transcript never arrives: the recorder stays in transcription.
  expect(voice.microphone.phase).toBe("transcribing");
  // The checks read the page directly: waiting for it would also move the fake clock on.
  await act(() => vi.advanceTimersByTime(59_999));
  expect(screen.getByRole("status").element()).toHaveTextContent("Thinking");

  await act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("status").element()).toHaveTextContent("Voice input stopped");
  expect(screen.getByText("Voice input took too long").element()).toBeVisible();
  expect(voice.microphone.phase).toBe("idle");

  await press(screen.getByRole("button", { name: "Try the microphone again" }));
  expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 2 });
});

it("voice chat moves on from a reply the speech engine never started, 4 seconds after handing it over", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(false, [OLD_REPLY, QUESTION, NEW_REPLY]));
  expect(screen.getByRole("status").element()).toHaveTextContent("Speaking");

  // No start, end or error event ever comes, and the engine reports nothing queued or speaking.
  // The checks read the page directly: waiting for it would also move the fake clock on.
  await act(() => vi.advanceTimersByTime(3_999));
  expect(screen.getByRole("status").element()).toHaveTextContent("Speaking");
  await act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("status").element()).toHaveTextContent("Listening");
  expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 2 });
});

it("voice chat moves on from a reply the speech engine keeps speaking past its deadline", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  using _speaking = vi.spyOn(window.speechSynthesis, "speaking", "get").mockReturnValue(true);
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(false, [OLD_REPLY, QUESTION, NEW_REPLY]));
  expect(screen.getByRole("status").element()).toHaveTextContent("Speaking");
  const deadline = speechDeadlineMs(NEW_REPLY_SPOKEN);

  // The engine reports speaking without any start event, so the length-based deadline counts
  // from the 4 second check that saw it speak. The checks read the page directly: waiting for it
  // would also move the fake clock on.
  await act(() => vi.advanceTimersByTime(4_000));
  await act(() => vi.advanceTimersByTime(deadline - 1));
  expect(screen.getByRole("status").element()).toHaveTextContent("Speaking");
  await act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("status").element()).toHaveTextContent("Listening");

  // The engine reports the end late; it must not end the next turn.
  await act(() => voice.spoken[0]?.onend?.(new Event("end") as SpeechSynthesisEvent));
  expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 2 });
  expect(screen.getByRole("status").element()).toHaveTextContent("Listening");
});

it("the first reply in the Conqueror voice waits for the device's voice list instead of using the default voice", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  const deepVoice = {
    name: "Daniel",
    lang: "en-GB",
    default: false,
    localService: true,
    voiceURI: "Daniel",
  } as SpeechSynthesisVoice;
  // The browser only accepts the voices it listed itself, so this test listens to a plain utterance.
  using _utterance = stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      voice: SpeechSynthesisVoice | null = null;
      lang = "";
      pitch = 1;
      rate = 1;
      constructor(readonly text: string) {}
    },
  );
  const listed: SpeechSynthesisVoice[] = [];
  using _voices = vi.spyOn(window.speechSynthesis, "getVoices").mockImplementation(() => listed);
  using _language = vi.spyOn(document.documentElement, "lang", "get").mockReturnValue("en-GB");
  using _style = {
    [Symbol.dispose]: () => setVoiceChatStyle("natural"),
  };
  setVoiceChatStyle("conqueror");

  await voice.start();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(false, [OLD_REPLY, QUESTION, NEW_REPLY]));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  expect(voice.spoken).toEqual([]);

  listed.push(deepVoice);
  await act(() => window.speechSynthesis.dispatchEvent(new Event("voiceschanged")));
  expect(voice.spoken).toHaveLength(1);
  expect(voice.spoken[0]?.voice?.name).toBe("Daniel");
});

function StyleProbe() {
  return <output>{useVoiceChatStyle()}</output>;
}

it("a change to the reading style made in another window reaches the switch and the next reply", async () => {
  await using screen = await render(<StyleProbe />, NO_ROUTER);
  using _style = {
    [Symbol.dispose]: () => setVoiceChatStyle("natural"),
  };
  await expect.element(screen.getByText("natural")).toBeVisible();

  // Another window wrote the choice; the browser reports it here as a storage event.
  window.localStorage.setItem("one:voice-chat-style", "conqueror");
  await act(() =>
    window.dispatchEvent(new StorageEvent("storage", { key: "one:voice-chat-style" })),
  );
  await expect.element(screen.getByText("conqueror")).toBeVisible();
  expect(getVoiceChatStyle()).toBe("conqueror");
});

it("voice chat covers the content behind it from the keyboard, keeps its transcript reachable and hands focus back to the composer when its launcher is gone", async () => {
  using voice = setup();
  await using screen = await render(
    <>
      <main data-testid="behind">
        <button type="button">Behind</button>
      </main>
      <form data-chat-composer-form="true">
        <div data-testid="composer-editor" tabIndex={0} />
      </form>
      {voice.stage(false, [])}
    </>,
    NO_ROUTER,
  );
  const behind = screen.container.querySelector<HTMLElement>('[data-testid="behind"]');
  const composer = screen.container.querySelector<HTMLElement>('[data-testid="composer-editor"]');

  await voice.start();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Listening");
  expect(behind?.inert).toBe(true);
  expect(composer?.inert).toBe(false);
  const transcript = screen.getByRole("region", { name: "Voice chat transcript" });
  await expect.element(transcript).toHaveAttribute("tabindex", "0");
  // The dialog does not claim to block the whole page, so it does not trap Tab either.
  await expect
    .element(screen.getByRole("dialog", { name: "Voice chat" }))
    .not.toHaveAttribute("aria-modal");

  await screen.getByRole("button", { name: "End voice chat" }).click();
  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).not.toBeInTheDocument();
  expect(behind?.inert).toBe(false);
  expect(document.activeElement).toBe(composer);
});

it("starting voice chat with no transcription source says why once, however often it is tried, and offers the setting instead of listening", async () => {
  using voice = setup();
  voice.needSetup();
  // The toast viewport reads the route, so this one renders with the test router.
  await using _screen = await render(<ToastProvider>{voice.stage(false, [])}</ToastProvider>);
  const bridge = getVoiceBridge();
  if (bridge === null) throw new Error("the composer published no voice controls");

  await act(() => {
    startVoiceChat(bridge);
    startVoiceChat(bridge);
  });

  // Strict locators fail on a second matching toast.
  await expect.element(page.getByText("Voice input is off")).toBeVisible();
  await expect
    .element(page.getByText("Choose where your speech is turned into text", { exact: false }))
    .toBeVisible();
  expect(getVoiceSession().stage).toBe("off");
  // The notice carries the control that fixes it; nothing opens until it is pressed.
  expect(voice.microphone.setupOpened).toBe(0);
  await page.getByRole("button", { name: "Open Voice settings" }).click();
  expect(voice.microphone.setupOpened).toBe(1);
  // The notice has done its job and goes.
  await expect.element(page.getByText("Voice input is off")).not.toBeInTheDocument();
});

it("voice chat that stops hearing closes with a notice that opens Voice settings", async () => {
  using voice = setup();
  await using screen = await render(<ToastProvider>{voice.stage(false, [])}</ToastProvider>);
  using _timers = fakeTimers();

  await voice.start();
  // The setting was turned off while voice chat was open: nothing is recording and nothing will.
  await voice.setAvailable(false);
  await voice.movePhase("idle");
  await act(() => vi.advanceTimersByTime(2_500));
  expect(screen.getByRole("dialog", { name: "Voice chat" }).query()).toBeNull();

  await expect.element(page.getByText("Voice input is no longer available.")).toBeVisible();
  await page.getByRole("button", { name: "Open Voice settings" }).click();
  expect(voice.microphone.setupOpened).toBe(1);
});

const OTHER_QUESTION: VoiceStageMessage = {
  id: "u9",
  role: "user",
  text: "what time is it",
  streaming: false,
  runId: "run-other",
};
const OTHER_REPLY: VoiceStageMessage = {
  id: "a9",
  role: "assistant",
  text: "It is noon.",
  streaming: false,
  runId: "run-other",
};
const SPOKEN_QUESTION: VoiceStageMessage = { ...QUESTION, runId: "run-voice" };
const SPOKEN_REPLY: VoiceStageMessage = { ...NEW_REPLY, runId: "run-voice" };

it("voice chat does not read the answer to another prompt that landed first, and reads its own reply once", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));

  await voice.start();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing();
  // A second client sent a prompt while the transcript was in flight, and its answer is already in.
  await screen.rerender(voice.stage(false, [OLD_REPLY, OTHER_QUESTION, OTHER_REPLY]));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Thinking");
  expect(voice.spoken).toEqual([]);

  await screen.rerender(
    voice.stage(true, [OLD_REPLY, OTHER_QUESTION, OTHER_REPLY, SPOKEN_QUESTION]),
  );
  await screen.rerender(
    voice.stage(false, [OLD_REPLY, OTHER_QUESTION, OTHER_REPLY, SPOKEN_QUESTION, SPOKEN_REPLY]),
  );
  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([NEW_REPLY_SPOKEN]);
});

/** A saved thread's user message, whose item id differs from the id the composer gave it. */
function savedQuestion(itemId: string, messageId: string, text: string, runId: string) {
  return {
    position: 0,
    visibility: "local",
    item: { id: itemId, type: "user_message", messageId, text, runId, inputIntent: "start" },
  };
}

function savedRun(id: string, userMessageId: string, status: string) {
  return { id, userMessageId, status };
}

function savedReply(itemId: string, text: string, runId: string) {
  return {
    position: 0,
    visibility: "local",
    item: { id: itemId, type: "assistant_message", text, runId, streaming: false },
  };
}

it("voice chat reads the reply to a question the composer sent with an effort prefix added to its words", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));

  await voice.start();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing("message-1");
  const question = savedQuestion(
    "item-1",
    "message-1",
    "Ultrathink:\nwhy is the sky blue",
    "run-1",
  );
  saved.rows = [question];
  saved.runs = [savedRun("run-1", "message-1", "running")];
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  saved.rows = [question, savedReply("item-2", "Light bends inside each drop.", "run-1")];
  saved.runs = [savedRun("run-1", "message-1", "completed")];
  await screen.rerender(voice.stage(false, [], false, SAVED_THREAD));

  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([
    "Light bends inside each drop.",
  ]);
});

it("voice chat does not read another client's answer to a prompt with the same words as its own question", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));

  await voice.start();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing("message-1");
  // Another client sent the same words first, and its answer is already in.
  const other = [
    savedQuestion("item-9", "message-9", "why is the sky blue", "run-other"),
    savedReply("item-10", "It is noon.", "run-other"),
  ];
  saved.rows = other;
  saved.runs = [savedRun("run-other", "message-9", "completed")];
  await screen.rerender(voice.stage(false, [], false, SAVED_THREAD));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Thinking");
  expect(voice.spoken).toEqual([]);

  const own = savedQuestion("item-1", "message-1", "why is the sky blue", "run-1");
  saved.rows = [...other, own];
  saved.runs = [...saved.runs, savedRun("run-1", "message-1", "running")];
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  saved.rows = [...other, own, savedReply("item-2", "Light bends inside each drop.", "run-1")];
  saved.runs = [saved.runs[0]!, savedRun("run-1", "message-1", "completed")];
  await screen.rerender(voice.stage(false, [], false, SAVED_THREAD));

  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([
    "Light bends inside each drop.",
  ]);
});

const stageOf = (screen: { getByRole: (role: "dialog", options: { name: string }) => unknown }) =>
  (screen.getByRole("dialog", { name: "Voice chat" }) as { element: () => Element }).element();

it("voice chat keeps waiting through a long queue, then reads the answer once the queued turn starts", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  using _timers = fakeTimers();
  const other = savedQuestion("item-9", "message-9", "what time is it", "run-other");
  const queued = savedQuestion("item-1", "message-q", "why is the sky blue", "run-q");

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  // As the server publishes a queued question: its run exists at once, its transcript row does not.
  saved.rows = [other];
  saved.runs = [
    savedRun("run-other", "message-9", "running"),
    savedRun("run-q", "message-q", "queued"),
  ];
  await voice.finishTranscribing("message-q");
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "thinking");

  // The other turn ends while the queued one waits to start, and the wait outlasts every deadline.
  saved.runs = [
    savedRun("run-other", "message-9", "completed"),
    savedRun("run-q", "message-q", "queued"),
  ];
  await screen.rerender(voice.stage(false, [], false, SAVED_THREAD));
  await act(() => vi.advanceTimersByTime(65_000));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "thinking");

  // It starts: the transcript row appears with the run, then the answer.
  saved.rows = [other, queued];
  saved.runs = [
    savedRun("run-other", "message-9", "completed"),
    savedRun("run-q", "message-q", "running"),
  ];
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  saved.rows = [other, queued, savedReply("item-2", "Light bends inside each drop.", "run-q")];
  saved.runs = [
    savedRun("run-other", "message-9", "completed"),
    savedRun("run-q", "message-q", "completed"),
  ];
  await screen.rerender(voice.stage(false, [], false, SAVED_THREAD));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "speaking");
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([
    "Light bends inside each drop.",
  ]);
});

it("voice chat listens again when its queued turn is cancelled before it starts", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  saved.runs = [savedRun("run-q", "message-q", "queued")];
  await voice.finishTranscribing("message-q");
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "thinking");

  // The person cancels the queued turn: no transcript row, no answer, ever.
  saved.runs = [savedRun("run-q", "message-q", "cancelled")];
  await screen.rerender(voice.stage(false, [], false, SAVED_THREAD));
  await act(() => vi.advanceTimersByTime(4_000));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "listening");
});

it("voice chat releases the stage with a plain message when its queued turn is held", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  saved.runs = [{ ...savedRun("run-q", "message-q", "queued"), queueHeld: true }];
  await voice.finishTranscribing("message-q");
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));

  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "listening");
  expect(
    screen
      .getByText("The question is held in the queue, so there is no reply to read yet")
      .element(),
  ).toBeVisible();
});

it("voice chat gives up when the turn it was following disappears from the thread", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  saved.runs = [savedRun("run-q", "message-q", "running")];
  await voice.finishTranscribing("message-q");
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "thinking");

  // The thread was deleted: the projection is gone.
  saved.rows = [];
  saved.runs = [];
  await screen.rerender(voice.stage(false, [], false, SAVED_THREAD));
  await act(() => vi.advanceTimersByTime(10_000));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "listening");
  expect(screen.getByText("The reply is no longer available").element()).toBeVisible();
});

const CONNECTION_LOST =
  "Lost the connection. Your question was sent; the answer will appear in the thread.";

it("voice chat stops waiting 20 seconds after the connection drops during its running turn, and says so aloud", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  saved.runs = [savedRun("run-q", "message-q", "running")];
  await voice.finishTranscribing("message-q");
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "thinking");

  // The socket drops: the thread keeps its last projection, with the run still running.
  saved.status = "cached";
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  await act(() => vi.advanceTimersByTime(19_999));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "thinking");
  expect(voice.spoken).toEqual([]);

  await act(() => vi.advanceTimersByTime(1));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "speaking");
  expect(screen.getByText(CONNECTION_LOST).element()).toBeVisible();
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([CONNECTION_LOST]);

  // Once it has been said, the person can act again.
  await act(() => voice.spoken[0]?.onend?.(new Event("end") as SpeechSynthesisEvent));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "listening");
});

it("voice chat keeps following its turn when the connection returns within the grace, and reads the answer", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  using _timers = fakeTimers();
  const question = savedQuestion("item-1", "message-q", "why is the sky blue", "run-q");

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  saved.rows = [question];
  saved.runs = [savedRun("run-q", "message-q", "running")];
  await voice.finishTranscribing("message-q");
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));

  saved.status = "cached";
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  await act(() => vi.advanceTimersByTime(12_000));
  // The reconnect catches up, then the thread is live again with the finished turn.
  saved.status = "synchronizing";
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  await act(() => vi.advanceTimersByTime(3_000));
  saved.status = "live";
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  // The run keeps going on a live connection for longer than the grace; that is not a lost turn.
  await act(() => vi.advanceTimersByTime(30_000));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "thinking");
  saved.rows = [question, savedReply("item-2", "Light bends inside each drop.", "run-q")];
  saved.runs = [savedRun("run-q", "message-q", "completed")];
  await screen.rerender(voice.stage(false, [], false, SAVED_THREAD));

  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "speaking");
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([
    "Light bends inside each drop.",
  ]);
});

it("voice chat does not count the time of an earlier drop against a later one", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  saved.runs = [savedRun("run-q", "message-q", "running")];
  await voice.finishTranscribing("message-q");
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));

  for (const _drop of [1, 2]) {
    saved.status = "cached";
    await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
    await act(() => vi.advanceTimersByTime(15_000));
    saved.status = "live";
    await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  }
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "thinking");
});

it("voice chat stops waiting on a queued turn once its connection has been gone 20 seconds", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  saved.runs = [
    savedRun("run-other", "message-9", "running"),
    savedRun("run-q", "message-q", "queued"),
  ];
  await voice.finishTranscribing("message-q");
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "thinking");

  saved.status = "cached";
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  await act(() => vi.advanceTimersByTime(20_000));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "speaking");
  expect(screen.getByText(CONNECTION_LOST).element()).toBeVisible();
});

it("voice chat gives up 60 seconds after a request went out that the thread never shows", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.finishTranscribing("message-q");
  await act(() => vi.advanceTimersByTime(59_999));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "sending");
  await act(() => vi.advanceTimersByTime(1));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "listening");
  expect(screen.getByText("The question was not accepted in time").element()).toBeVisible();
});

it("voice chat does not move to thinking when another client's run starts before its own request exists", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.movePhase("idle");
  saved.rows = [savedQuestion("item-9", "message-9", "what time is it", "run-other")];
  saved.runs = [savedRun("run-other", "message-9", "running")];
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "sending");

  // Its own request goes out and shows up in the thread: now the turn is its own.
  await voice.finishTranscribing("message-1");
  saved.runs = [...saved.runs, savedRun("run-1", "message-1", "queued")];
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "thinking");
});

it("voice chat listens again with the server's reason when the turn request is rejected", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.finishTranscribing("message-1");
  await voice.endSend((report) => report.rejected("Attachment 'a.png' cannot be sent."));

  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "listening");
  expect(screen.getByText("Attachment 'a.png' cannot be sent.").element()).toBeVisible();
  expect(screen.getByRole("button", { name: "Try the microphone again" }).element()).toBeVisible();
});

it("voice chat says a question that became a side chat has no reply to read, and listens again", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.endSend((report) => report.notSent("side-chat"));

  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "listening");
  expect(
    screen.getByText("That went to a side chat, so there is no reply to read here").element(),
  ).toBeVisible();
});

it("voice chat listens again at once when dictation ended with no text, not after the 6 second send timeout", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "sending");
  // The composer's dictation ended with an empty transcript, so no turn request was ever made.
  await voice.endSend((report) => report.notSent("none"));

  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "listening");
  expect(screen.getByText("The question was not sent").element()).toBeVisible();
  expect(voice.microphone.submits).toBe(1);
});

it("voice chat does not read a later row from a run it already read, and listens again instead", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  using _timers = fakeTimers();
  const firstRun = [OLD_REPLY, { ...QUESTION, runId: "run-1" }, { ...NEW_REPLY, runId: "run-1" }];

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(true, firstRun.slice(0, 2)));
  await screen.rerender(voice.stage(false, firstRun));
  expect(screen.getByRole("status").element()).toHaveTextContent("Speaking");
  await act(() => voice.spoken[0]?.onend?.(new Event("end") as SpeechSynthesisEvent));

  // The next spoken question starts its own run; the first run publishes one more message.
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.finishTranscribing("u3");
  const secondQuestion = { ...QUESTION, id: "u3", runId: "run-2" };
  await screen.rerender(voice.stage(true, [...firstRun, secondQuestion]));
  const lateFromFirstRun = { ...NEW_REPLY, id: "a2b", text: "One more thing.", runId: "run-1" };
  await screen.rerender(voice.stage(false, [...firstRun, secondQuestion, lateFromFirstRun]));
  expect(screen.getByRole("status").element()).toHaveTextContent("Thinking");

  await act(() => vi.advanceTimersByTime(4_000));
  expect(screen.getByRole("status").element()).toHaveTextContent("Listening");
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([NEW_REPLY_SPOKEN]);
});

it("voice chat gives up 60 seconds after the question was sent even when the recorder changed phase at 59 seconds", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  expect(voice.microphone.phase).toBe("transcribing");
  await act(() => vi.advanceTimersByTime(59_000));
  // The transcript came in and its cleanup began, which hangs.
  await voice.movePhase("post-processing");
  await act(() => vi.advanceTimersByTime(999));
  expect(screen.getByRole("status").element()).toHaveTextContent("Thinking");

  await act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("status").element()).toHaveTextContent("Voice input stopped");
  expect(screen.getByText("Voice input took too long").element()).toBeVisible();
  expect(voice.microphone.phase).toBe("idle");
});

it("voice chat abandons a reply the speech engine keeps queued and never starts, after one retry", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  // The engine holds the utterance back: queued, not speaking, and no event ever comes.
  using _pending = vi.spyOn(window.speechSynthesis, "pending", "get").mockReturnValue(true);
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(false, [OLD_REPLY, QUESTION, NEW_REPLY]));
  expect(screen.getByRole("status").element()).toHaveTextContent("Speaking");
  expect(voice.spoken).toHaveLength(1);

  // The checks read the page directly: waiting for it would also move the fake clock on.
  await act(() => vi.advanceTimersByTime(5_999));
  expect(voice.spoken).toHaveLength(1);
  await act(() => vi.advanceTimersByTime(1));
  expect(voice.spoken).toHaveLength(2);
  expect(screen.getByRole("status").element()).toHaveTextContent("Speaking");
  // The first utterance reports its cancellation late; that must not end the retried reading.
  await act(() => voice.spoken[0]?.onerror?.(new Event("error") as SpeechSynthesisErrorEvent));
  expect(screen.getByRole("status").element()).toHaveTextContent("Speaking");

  await act(() => vi.advanceTimersByTime(5_999));
  expect(screen.getByRole("status").element()).toHaveTextContent("Speaking");
  await act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("status").element()).toHaveTextContent("Listening");
  expect(voice.spoken).toHaveLength(2);
  expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 2 });
});

it("voice chat keeps reading a reply the engine began between the 4 and 6 second checks, without restarting it", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  // The engine holds the utterance queued at first, then begins it without sending a start event.
  const engine = { speaking: false };
  using _pending = vi.spyOn(window.speechSynthesis, "pending", "get").mockReturnValue(true);
  using _speaking = vi
    .spyOn(window.speechSynthesis, "speaking", "get")
    .mockImplementation(() => engine.speaking);
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(false, [OLD_REPLY, QUESTION, NEW_REPLY]));
  expect(voice.spoken).toHaveLength(1);

  await act(() => vi.advanceTimersByTime(5_000));
  engine.speaking = true;
  // The checks read the page directly: waiting for it would also move the fake clock on.
  await act(() => vi.advanceTimersByTime(1_000));
  expect(voice.spoken).toHaveLength(1);
  expect(screen.getByRole("status").element()).toHaveTextContent("Speaking");

  // The length-based deadline now counts from the 6 second check that saw it speak.
  await act(() => vi.advanceTimersByTime(speechDeadlineMs(NEW_REPLY_SPOKEN)));
  expect(screen.getByRole("status").element()).toHaveTextContent("Listening");
  expect(voice.spoken).toHaveLength(1);
});

it("voice chat moves on from a reply the engine dropped between the 4 and 6 second checks, without queueing it again", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  // The engine holds the utterance queued at the first check, then drops it without any event.
  const engine = { pending: true };
  using _pending = vi
    .spyOn(window.speechSynthesis, "pending", "get")
    .mockImplementation(() => engine.pending);
  using _timers = fakeTimers();

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(false, [OLD_REPLY, QUESTION, NEW_REPLY]));
  expect(voice.spoken).toHaveLength(1);

  await act(() => vi.advanceTimersByTime(5_000));
  engine.pending = false;
  // The checks read the page directly: waiting for it would also move the fake clock on.
  await act(() => vi.advanceTimersByTime(1_000));
  expect(voice.spoken).toHaveLength(1);
  expect(screen.getByRole("status").element()).toHaveTextContent("Listening");
  expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 2 });
});

it("voice chat steps aside when a secret request appears in the thread while the agent answers", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);

  await voice.start();
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Thinking");

  // The agent asks for a secret; the card sits behind the voice dialog in the timeline.
  saved.rows = [
    {
      position: 0,
      visibility: "local",
      item: { id: "s1", type: "secret_request", secretStatus: "pending" },
    },
  ];
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).not.toBeInTheDocument();
});

function savedFeedbackCard(itemId: string) {
  return {
    position: 0,
    visibility: "local",
    item: { id: itemId, type: "feedback_request", feedbackStatus: "pending" },
  };
}

it("voice chat starts beside an optional feedback card left pending earlier, and closes when a new one arrives", async () => {
  using voice = setup();
  saved.rows = [savedFeedbackCard("feedback-old")];
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);

  await voice.start();
  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).toBeVisible();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Listening");

  saved.rows = [savedFeedbackCard("feedback-old"), savedFeedbackCard("feedback-new")];
  await screen.rerender(voice.stage(false, [], false, SAVED_THREAD));
  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).not.toBeInTheDocument();
});

it("dictation started with the ordinary shortcut after a retried microphone start failed again is neither sent nor cancelled by voice chat", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _timers = fakeTimers();
  using _level = { [Symbol.dispose]: () => void (voiceLevel.current = 0) };

  await voice.start();
  await voice.failRecording();
  // The retry ends straight back in the same error, so the recorder's phase never changes.
  voice.failStartsFromNow();
  await press(screen.getByRole("button", { name: "Try the microphone again" }));
  expect(voice.microphone).toMatchObject({ phase: "error", recordings: 1 });

  await voice.startOrdinaryDictation();
  // Speech and then a pause would send a recording voice chat owns.
  voiceLevel.current = 0.5;
  await act(() => vi.advanceTimersByTime(600));
  voiceLevel.current = 0;
  await act(() => vi.advanceTimersByTime(2_000));
  expect(voice.microphone).toMatchObject({ phase: "recording", submits: 0 });

  await press(screen.getByRole("button", { name: "End voice chat" }));
  expect(screen.getByRole("dialog", { name: "Voice chat" }).query()).toBeNull();
  expect(voice.microphone.phase).toBe("recording");
});

const swellOf = (screen: { getByRole: (role: "dialog", options: { name: string }) => unknown }) =>
  stageOf(screen).querySelector<HTMLElement>(".one-voice-orb-swell")!;

it("the ring swells with the microphone level by transform only, never above 8 percent, and settles smoothly when the sound stops", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _timers = fakeTimers();
  using _level = { [Symbol.dispose]: () => void (voiceLevel.current = 0) };

  await voice.start();
  const swell = swellOf(screen);
  const scales: number[] = [];
  voiceLevel.current = 1;
  for (let frame = 0; frame < 30; frame += 1) {
    await act(() => vi.advanceTimersByTime(16));
    scales.push(Number(/scale\(([\d.]+)\)/.exec(swell.style.transform)?.[1] ?? 1));
  }
  expect(Math.max(...scales)).toBeGreaterThan(1.06);
  expect(Math.max(...scales)).toBeLessThanOrEqual(1.08);
  // Rising: never a step larger than a third of the full swing, so it cannot read as a jitter.
  expect(
    Math.max(...scales.slice(1).map((value, index) => Math.abs(value - scales[index]!))),
  ).toBeLessThan(0.027);
  // Only a transform moves: no layout property is written to the element.
  expect(swell.style.cssText).toBe(`transform: ${swell.style.transform};`);

  voiceLevel.current = 0;
  await act(() => vi.advanceTimersByTime(16 * 8));
  const falling = Number(/scale\(([\d.]+)\)/.exec(swell.style.transform)?.[1]);
  expect(falling).toBeGreaterThan(1.0);
  expect(falling).toBeLessThan(Math.max(...scales));
  await act(() => vi.advanceTimersByTime(2_000));
  expect(swell.style.transform).toBe("scale(1)");
});

it("muting voice chat stops its recording and keeps it from listening or closing until it is unmuted", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _timers = fakeTimers();

  await voice.start();
  expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 1 });

  await press(screen.getByRole("button", { name: "Mute microphone" }));
  expect(voice.microphone.phase).toBe("idle");
  expect(stageOf(screen)).toHaveAttribute("data-look", "muted");
  expect(screen.getByRole("status").element()).toHaveTextContent("Muted");
  // A microphone that never starts closes voice chat after a few seconds; a muted one must not.
  await act(() => vi.advanceTimersByTime(10_000));
  expect(stageOf(screen)).toHaveAttribute("data-look", "muted");
  expect(voice.microphone).toMatchObject({ phase: "idle", recordings: 1 });

  await press(screen.getByRole("button", { name: "Mute microphone" }));
  expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 2 });
  expect(stageOf(screen)).toHaveAttribute("data-look", "listening");
});

it("the M key mutes and unmutes voice chat, and pressing the ring while muted unmutes", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _timers = fakeTimers();
  const typeKey = (target: EventTarget, init: KeyboardEventInit) =>
    act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })));

  await voice.start();
  await typeKey(window, { key: "m" });
  expect(stageOf(screen)).toHaveAttribute("data-look", "muted");
  await press(screen.getByRole("button", { name: "Unmute microphone" }));
  expect(stageOf(screen)).toHaveAttribute("data-look", "listening");

  // Typing the letter in a field, or a shortcut that uses it, is not a mute.
  const field = document.createElement("input");
  document.body.append(field);
  using _field = { [Symbol.dispose]: () => field.remove() };
  await typeKey(field, { key: "m" });
  await typeKey(window, { key: "m", metaKey: true });
  expect(stageOf(screen)).toHaveAttribute("data-look", "listening");

  await typeKey(window, { key: "M" });
  expect(stageOf(screen)).toHaveAttribute("data-look", "muted");
});

it("each stage of a spoken turn shows its own state label and look, so none depends on sound", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  using _timers = fakeTimers();
  const seen: Array<readonly [string | null, string | null]> = [];
  const note = () =>
    seen.push([
      stageOf(screen).getAttribute("data-look"),
      screen.getByRole("status").element().textContent,
    ]);

  await voice.start();
  note();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(true, [OLD_REPLY]));
  note();
  await screen.rerender(voice.stage(false, [OLD_REPLY, QUESTION, NEW_REPLY]));
  note();
  await press(screen.getByRole("button", { name: "Stop reading and listen" }));
  note();
  await act(() => vi.advanceTimersByTime(900));
  note();

  expect(seen).toEqual([
    ["listening", "Listening"],
    ["thinking", "Thinking"],
    ["speaking", "Speaking"],
    ["interrupted", "Interrupted"],
    ["listening", "Listening"],
  ]);
});

it("Escape ends voice chat even while a closed dialog, such as the phone's sidebar sheet, sits elsewhere in the page", async () => {
  using voice = setup();
  await using screen = await render(
    <>
      <div>
        <div role="dialog" />
      </div>
      {voice.stage(false, [])}
    </>,
    NO_ROUTER,
  );
  using _timers = fakeTimers();

  await voice.start();
  expect(stageOf(screen)).toHaveAttribute("data-look", "listening");
  await act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(screen.getByRole("dialog", { name: "Voice chat" }).query()).toBeNull();
});

it("the question stays on screen while the agent works, even when the thread's row for it comes and goes", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [], false, SAVED_THREAD), NO_ROUTER);
  using _timers = fakeTimers();
  const question = savedQuestion("item-1", "message-q", "Why is the sky blue?", "run-q");

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  saved.runs = [savedRun("run-q", "message-q", "running")];
  await voice.finishTranscribing("message-q");
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  saved.rows = [question];
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  expect(screen.getByText("Why is the sky blue?").element()).toBeVisible();

  // The row leaves the visible window of the thread; the words must not fall back to a partial transcript.
  saved.rows = [];
  await screen.rerender(voice.stage(true, [], false, SAVED_THREAD));
  expect(screen.getByText("Why is the sky blue?").element()).toBeVisible();
});

/** Brings the stage to Speaking with `reply` as the answer, the way the first test in this file does. */
async function speakReply(
  voice: ReturnType<typeof setup>,
  screen: Awaited<ReturnType<typeof render>>,
  reply: VoiceStageMessage,
) {
  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(true, [OLD_REPLY]));
  await screen.rerender(voice.stage(false, [OLD_REPLY, QUESTION, reply]));
  expect(stageOf(screen)).toHaveAttribute("data-one-voice-stage", "speaking");
}

const warmWords = (screen: Awaited<ReturnType<typeof render>>) =>
  [...(screenCaption(screen)?.querySelectorAll(".one-voice-word.is-spoken") ?? [])].map(
    (word) => word.textContent,
  );

function screenCaption(screen: Awaited<ReturnType<typeof render>>): HTMLElement | null {
  return stageOf(screen).querySelector<HTMLElement>(".one-voice-caption");
}

it("each word of the reply warms from bone to gold as the speech engine reaches it, and none ahead of it", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  using _timers = fakeTimers();
  const reply = { ...NEW_REPLY, text: "Light bends. It splits into colors." };
  const text = "Light bends. It splits into colors.";

  await speakReply(voice, screen, reply);
  expect(warmWords(screen)).toEqual([]);

  const boundary = (charIndex: number) =>
    act(() => voice.spoken[0]?.onboundary?.({ name: "word", charIndex } as SpeechSynthesisEvent));
  await boundary(0);
  expect(warmWords(screen)).toEqual(["Light"]);
  await boundary(text.indexOf("It"));
  expect(warmWords(screen)).toEqual(["Light", "bends.", "It"]);
  await boundary(text.indexOf("colors"));
  expect(warmWords(screen)).toEqual(["Light", "bends.", "It", "splits", "into", "colors."]);
});

it("when the engine gives no word timing, the caption warms one sentence at a time, by an estimate of the speaking time", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));
  using _timers = fakeTimers();
  const text = "Light bends. It splits into colors. Then it fades.";
  const reply = { ...NEW_REPLY, text };

  await speakReply(voice, screen, reply);
  // The engine starts the utterance but never reports a word boundary.
  await act(() => voice.spoken[0]?.onstart?.(new Event("start") as SpeechSynthesisEvent));
  expect(warmWords(screen)).toEqual([]);

  // After the wait, the sentences the estimate says are under way warm at once: the first starts at 0 s
  // and the second about 13 characters in, which is 0.93 s at 14 characters a second.
  await act(() => vi.advanceTimersByTime(1_200));
  expect(warmWords(screen)).toEqual(["Light", "bends.", "It", "splits", "into", "colors."]);
  // The third starts 36 characters in, which is 2.57 s.
  await act(() => vi.advanceTimersByTime(1_300));
  expect(warmWords(screen)).toHaveLength(6);
  await act(() => vi.advanceTimersByTime(100));
  expect(warmWords(screen)).toHaveLength(text.split(" ").length);
});

it("the status is the one current word for screen readers, with the previous word fading out beside it", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _timers = fakeTimers();

  await voice.start();
  expect(screen.getByRole("status").element()).toHaveTextContent("Listening");
  await press(screen.getByRole("button", { name: "Send what I said" }));
  const status = screen.getByRole("status").element();
  expect(status).toHaveTextContent("Thinking");
  const fading = stageOf(screen).querySelector(".one-voice-status-out");
  expect(fading).toHaveTextContent("Listening");
  expect(fading).toHaveAttribute("aria-hidden", "true");
  // The screen reader's status holds one word only.
  expect(status.textContent).toBe("Thinking");
});

it("no toast shows over the stage, however it was raised, and it appears once voice chat closes", async () => {
  using voice = setup();
  await using screen = await render(<ToastProvider>{voice.stage(false, [])}</ToastProvider>);

  await voice.start();
  // A promotional prompt and an ordinary notice, raised while the stage is open.
  await act(() => {
    toastManager.add({ type: "info", title: "Enjoying One?", description: "Give us a star" });
    toastManager.add({ type: "info", title: "Settings saved" });
  });
  expect(stageOf(screen)).toHaveAttribute("data-look", "listening");
  expect(page.getByText("Enjoying One?").query()).toBeNull();
  expect(page.getByText("Settings saved").query()).toBeNull();

  await act(() => dispatchVoiceSession({ type: "stop" }));
  await expect.element(page.getByText("Enjoying One?")).toBeVisible();
});

const keydown = (init: KeyboardEventInit): Promise<void> =>
  act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })));

it("holding M mutes once, however many key repeats arrive, and the microphone is started and stopped once", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _timers = fakeTimers();

  await voice.start();
  expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 1 });

  await keydown({ key: "m" });
  for (let repeat = 0; repeat < 15; repeat += 1) await keydown({ key: "m", repeat: true });
  expect(stageOf(screen)).toHaveAttribute("data-look", "muted");
  expect(voice.microphone).toMatchObject({ phase: "idle", recordings: 1 });

  // Released and pressed again: that is a new press, and it unmutes once.
  for (let repeat = 0; repeat < 15; repeat += 1) await keydown({ key: "M", repeat: true });
  expect(stageOf(screen)).toHaveAttribute("data-look", "muted");
  await keydown({ key: "m" });
  expect(stageOf(screen)).toHaveAttribute("data-look", "listening");
  expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 2 });
});

it("a held Escape that repeats before its first press was seen does not end voice chat", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), NO_ROUTER);
  using _timers = fakeTimers();

  await voice.start();
  await keydown({ key: "Escape", repeat: true });
  expect(stageOf(screen)).toHaveAttribute("data-look", "listening");
  await keydown({ key: "Escape" });
  expect(screen.getByRole("dialog", { name: "Voice chat" }).query()).toBeNull();
});

it("Escape ends voice chat with a toast waiting in the queue and another dialog open on the page", async () => {
  using voice = setup();
  await using screen = await render(
    <ToastProvider>
      <div role="dialog" aria-label="Something else" />
      {voice.stage(false, [])}
    </ToastProvider>,
  );

  await voice.start();
  await act(() => {
    toastManager.add({ id: "held-for-escape", type: "info", title: "Held for Escape" });
  });
  expect(page.getByText("Held for Escape").query()).toBeNull();
  await keydown({ key: "Escape" });

  expect(screen.getByRole("dialog", { name: "Voice chat" }).query()).toBeNull();
  await expect.element(page.getByText("Held for Escape")).toBeVisible();
  toastManager.close("held-for-escape");
});

const raiseHeldToast = (id: string) =>
  act(() => {
    toastManager.add({ id, type: "info", title: `Held ${id}` });
  });

it.each([
  [
    "Escape",
    async (): Promise<void> => {
      await keydown({ key: "Escape" });
    },
  ],
  [
    "the End voice chat button",
    async (): Promise<void> => {
      await press(page.getByRole("button", { name: "End voice chat" }));
    },
  ],
] as const)(
  "a toast raised during voice chat appears when it is ended by %s, not before",
  async (name, end) => {
    using voice = setup();
    await using screen = await render(<ToastProvider>{voice.stage(false, [])}</ToastProvider>);
    const id = `held-by-${name.replaceAll(" ", "-")}`;

    await voice.start();
    await raiseHeldToast(id);
    expect(page.getByText(`Held ${id}`).query()).toBeNull();
    await end();

    expect(screen.getByRole("dialog", { name: "Voice chat" }).query()).toBeNull();
    await expect.element(page.getByText(`Held ${id}`)).toBeVisible();
    toastManager.close(id);
  },
);

it("a toast raised during voice chat appears when the whole screen unmounts under it", async () => {
  using voice = setup();
  await using screen = await render(<ToastProvider>{voice.stage(false, [])}</ToastProvider>);

  await voice.start();
  await raiseHeldToast("held-by-unmount");
  expect(page.getByText("Held held-by-unmount").query()).toBeNull();
  await screen.rerender(<ToastProvider>{null}</ToastProvider>);

  await expect.element(page.getByText("Held held-by-unmount")).toBeVisible();
  toastManager.close("held-by-unmount");
});

it("a reply that streams in grows the transcript in place, with no fade out and in on each word", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), NO_ROUTER);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));

  await voice.start();
  await press(screen.getByRole("button", { name: "Send what I said" }));
  await voice.finishTranscribing();
  await screen.rerender(voice.stage(true, [OLD_REPLY, QUESTION]));
  const streaming = (text: string) => ({ ...NEW_REPLY, text, streaming: true });

  // The question gives way to the first words of the reply: one swap.
  await screen.rerender(voice.stage(true, [OLD_REPLY, QUESTION, streaming("Light")]));
  const leaving = stageOf(screen).querySelector<HTMLElement>(".one-voice-caption-out")!;
  await vi.waitFor(() => expect(leaving.getAnimations()).toHaveLength(1));
  leaving.getAnimations()[0]!.finish();
  await vi.waitFor(() =>
    expect(stageOf(screen).querySelector(".one-voice-caption-out")).toBeNull(),
  );

  // More words arrive: the same transcript grows and nothing leaves or enters.
  const caption = stageOf(screen).querySelector<HTMLElement>(".one-voice-caption")!;
  caption.getAnimations().forEach((animation) => animation.finish());
  for (const text of ["Light bends", "Light bends inside", "Light bends inside each drop."]) {
    await screen.rerender(voice.stage(true, [OLD_REPLY, QUESTION, streaming(text)]));
    expect(stageOf(screen).querySelector(".one-voice-caption-out")).toBeNull();
    expect(caption.textContent).toBe(text);
    expect(caption.getAnimations()).toHaveLength(0);
  }
});
