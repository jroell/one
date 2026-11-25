import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, fakeTimers, render, stubGlobal } from "../../test/render";
import { ToastProvider } from "../components/ui/toast";
import { OneVoiceStage, type VoiceStageMessage } from "./OneVoiceStage";
import { startVoiceChat } from "./startVoiceChat";
import {
  commitVoiceThread,
  getVoiceBridge,
  publishVoiceBridge,
  retractVoiceBridge,
} from "./voiceBridge";
import { getVoiceChatStyle, setVoiceChatStyle, useVoiceChatStyle } from "./voiceChatPreferences";
import { dispatchVoiceSession, getVoiceSession, speechDeadlineMs } from "./voiceSession";
import { setWorkspaceMode } from "./workspaceMode";

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

const QUESTION: VoiceStageMessage = {
  id: "u2",
  role: "user",
  text: "why is the sky blue",
  streaming: false,
};

type MicrophonePhase = "idle" | "preparing" | "recording" | "transcribing" | "error";

/** Stands in for the main composer's dictation: the microphone is the boundary being faked. */
function setup() {
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
    error: null as string | null,
    /** A start that was requested and has not begun recording (the permission prompt is open). */
    pendingStart: false,
    holdStarts: false,
    /** The start waits on a speech status check that has not answered yet; the recorder reports idle. */
    pendingStatus: null as AbortSignal | null,
    holdStatus: false,
    /** The signal each start was given. */
    signals: [] as Array<AbortSignal | undefined>,
  };
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
          return;
        }
        if (microphone.holdStatus) {
          microphone.pendingStatus = signal ?? null;
          return;
        }
        microphone.error = null;
        microphone.phase = "recording";
        microphone.recordings += 1;
        publish();
      },
      submit: () => {
        microphone.submits += 1;
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
    /** The transcript arrived and the composer sent it, as the real composer does after dictation. */
    finishTranscribing: () =>
      act(() => {
        microphone.phase = "idle";
        publish();
      }),
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
    stage: (isWorking: boolean, messages: ReadonlyArray<VoiceStageMessage>, needsUser = false) => (
      <OneVoiceStage
        threadRef={null}
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
  await screen.rerender(voice.stage(false, [OLD_REPLY, NEW_REPLY]));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  await expect.element(screen.getByText("Light bends inside each drop.")).toBeVisible();
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([
    "Light bends inside each drop.",
  ]);

  await act(() => voice.spoken[0]?.onend?.(new Event("end") as SpeechSynthesisEvent));
  await expect.element(screen.getByText("why is the sky blue")).toBeVisible();
  expect(voice.microphone).toMatchObject({ phase: "recording", recordings: 2 });
});

it("voice chat waits for a reply that is still streaming and reads it once, in full", async () => {
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
    voice.stage(false, [{ ...NEW_REPLY, text: "Light **bends**", streaming: true }]),
  );
  await expect.element(screen.getByRole("status")).toHaveTextContent("Thinking");
  expect(voice.spoken).toEqual([]);

  await screen.rerender(voice.stage(false, [NEW_REPLY]));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([
    "Light bends inside each drop.",
  ]);
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

  await screen.rerender(voice.stage(false, [NEW_REPLY]));
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
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([
    "Light bends inside each drop.",
  ]);
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

  await expect.element(screen.getByText("Light bends inside each drop.")).toBeVisible();
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([
    "Light bends inside each drop.",
  ]);
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
  const deadline = speechDeadlineMs("Light bends inside each drop.");

  // The checks read the page directly: waiting for it would also move the fake clock on.
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

it("starting voice chat without a transcription source explains it once, however often it is tried, and opens setup instead of listening", async () => {
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
  await expect.element(page.getByText("Voice chat needs a transcription source")).toBeVisible();
  await expect
    .element(page.getByText("Choose one under Transcribe with, then start voice chat again."))
    .toBeVisible();
  expect(getVoiceSession().stage).toBe("off");
  // Each attempt still goes to Voice settings, where the recorder hook navigates.
  expect(voice.microphone.signals).toHaveLength(2);
});
