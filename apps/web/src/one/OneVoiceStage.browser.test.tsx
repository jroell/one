import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { OneVoiceStage, type VoiceStageMessage } from "./OneVoiceStage";
import { publishVoiceBridge, retractVoiceBridge } from "./voiceBridge";
import { dispatchVoiceSession } from "./voiceSession";

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

/** Stands in for the composer's dictation: the microphone is the boundary being faked. */
function setup() {
  const microphone = { phase: "idle" as "idle" | "recording" | "transcribing" };
  const publish = () =>
    publishVoiceBridge(
      "test",
      {
        available: true,
        phase: microphone.phase,
        error: null,
        heard: microphone.phase === "recording" ? "why is the sky blue" : "",
        start: () => {
          microphone.phase = "recording";
          publish();
        },
        submit: () => {
          microphone.phase = "transcribing";
          publish();
        },
        cancel: () => {
          microphone.phase = "idle";
          publish();
        },
      },
      0,
    );
  publish();
  const spoken: SpeechSynthesisUtterance[] = [];
  return {
    microphone,
    spoken,
    stage: (isWorking: boolean, messages: ReadonlyArray<VoiceStageMessage>) => (
      <OneVoiceStage threadRef={null} isWorking={isWorking} draftMessages={messages} />
    ),
    [Symbol.dispose]() {
      dispatchVoiceSession({ type: "stop" });
      retractVoiceBridge("test");
    },
  };
}

it("voice chat sends the spoken question, reads only the new reply aloud, then listens again", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), {
    router: false /* voice chat does not navigate */,
  });
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));

  await act(() => dispatchVoiceSession({ type: "start" }));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Listening");
  await expect.element(screen.getByText("why is the sky blue")).toBeVisible();

  await screen.getByRole("button", { name: "Send what I said" }).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Thinking");
  expect(voice.microphone.phase).toBe("transcribing");

  await screen.rerender(voice.stage(true, [OLD_REPLY]));
  await screen.rerender(voice.stage(false, [OLD_REPLY, NEW_REPLY]));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Speaking");
  await expect.element(screen.getByText("Light bends inside each drop.")).toBeVisible();
  expect(voice.spoken.map((utterance) => utterance.text)).toEqual([
    "Light bends inside each drop.",
  ]);

  await act(() => voice.spoken[0]?.onend?.(new Event("end") as SpeechSynthesisEvent));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Listening");
});

it("voice chat does not read an old reply again when the turn adds no new one", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, [OLD_REPLY]), {
    router: false /* voice chat does not navigate */,
  });
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => void voice.spoken.push(utterance));

  await act(() => dispatchVoiceSession({ type: "start" }));
  await screen.getByRole("button", { name: "Send what I said" }).click();
  await screen.rerender(voice.stage(true, [OLD_REPLY]));
  await screen.rerender(voice.stage(false, [OLD_REPLY]));

  await expect.element(screen.getByRole("status")).toHaveTextContent("Listening");
  expect(voice.spoken).toEqual([]);
});

it("ending voice chat closes it and releases the microphone", async () => {
  using voice = setup();
  await using screen = await render(voice.stage(false, []), {
    router: false /* voice chat does not navigate */,
  });

  await act(() => dispatchVoiceSession({ type: "start" }));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Listening");
  expect(voice.microphone.phase).toBe("recording");

  await screen.getByRole("button", { name: "End voice chat" }).click();
  await expect.element(screen.getByRole("dialog", { name: "Voice chat" })).not.toBeInTheDocument();
  expect(voice.microphone.phase).toBe("idle");
});
