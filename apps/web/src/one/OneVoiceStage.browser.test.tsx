import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { OneVoiceStage, type VoiceStageMessage } from "./OneVoiceStage";
import { publishVoiceBridge, retractVoiceBridge } from "./voiceBridge";
import { dispatchVoiceSession } from "./voiceSession";
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

type MicrophonePhase = "idle" | "recording" | "transcribing" | "error";

/** Stands in for the main composer's dictation: the microphone is the boundary being faked. */
function setup() {
  const microphone = {
    phase: "idle" as MicrophonePhase,
    threadKey: "thread-a",
    isDraft: false,
    promotedFrom: null as string | null,
    draftEmpty: true,
    recordings: 0,
    /** A start that was requested and has not begun recording (the permission prompt is open). */
    pendingStart: false,
    holdStarts: false,
  };
  const publish = () =>
    publishVoiceBridge("test", {
      threadKey: microphone.threadKey,
      isDraft: microphone.isDraft,
      continuesDraft: (draftKey) => microphone.promotedFrom === draftKey,
      available: true,
      draftEmpty: microphone.draftEmpty,
      phase: microphone.phase,
      error: null,
      heard: microphone.phase === "recording" ? "why is the sky blue" : "",
      start: () => {
        if (microphone.holdStarts) {
          microphone.pendingStart = true;
          return;
        }
        microphone.phase = "recording";
        microphone.recordings += 1;
        publish();
      },
      submit: () => {
        microphone.phase = "transcribing";
        publish();
      },
      cancel: () => {
        microphone.pendingStart = false;
        microphone.phase = "idle";
        publish();
      },
    });
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
    failRecording: () =>
      act(() => {
        microphone.phase = "error";
        publish();
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
