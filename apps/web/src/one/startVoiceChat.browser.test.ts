import { expect, it } from "vite-plus/test";

import { startVoiceChat } from "./startVoiceChat";
import type { VoiceBridge } from "./voiceBridge";
import { dispatchVoiceSession, getVoiceSession } from "./voiceSession";
import { takeVoiceLauncher } from "./voiceStageMotion";

function bridge(overrides: Partial<VoiceBridge> = {}): VoiceBridge {
  return {
    threadKey: "thread-a",
    isDraft: false,
    continuesDraft: () => false,
    available: true,
    needsSetup: false,
    draftEmpty: true,
    phase: "idle",
    error: null,
    heard: "",
    start: () => Promise.resolve("started"),
    submit: () => undefined,
    cancel: () => undefined,
    ...overrides,
  };
}

function control(): HTMLButtonElement {
  const button = document.createElement("button");
  document.body.append(button);
  return button;
}

it("a start refused because the draft is not empty leaves no origin behind for the next voice chat", () => {
  using _session = { [Symbol.dispose]: () => dispatchVoiceSession({ type: "stop" }) };
  const header = control();
  using _header = { [Symbol.dispose]: () => header.remove() };

  startVoiceChat(bridge({ draftEmpty: false }), header);
  expect(getVoiceSession().stage).toBe("off");

  // The next conversation starts from the keyboard, with no control to fly from.
  startVoiceChat(bridge());
  expect(getVoiceSession().stage).toBe("listening");
  expect(takeVoiceLauncher()).toBeNull();
});

it("a start refused because setup is needed or dictation is under way leaves no origin behind either", () => {
  using _session = { [Symbol.dispose]: () => dispatchVoiceSession({ type: "stop" }) };
  const header = control();
  using _header = { [Symbol.dispose]: () => header.remove() };

  startVoiceChat(bridge({ needsSetup: true }), header);
  startVoiceChat(bridge({ phase: "recording" }), header);
  expect(getVoiceSession().stage).toBe("off");
  startVoiceChat(bridge());
  expect(takeVoiceLauncher()).toBeNull();
});

it("a start that goes ahead remembers the control that opened it, once", () => {
  using _session = { [Symbol.dispose]: () => dispatchVoiceSession({ type: "stop" }) };
  const header = control();
  using _header = { [Symbol.dispose]: () => header.remove() };

  startVoiceChat(bridge(), header);
  expect(getVoiceSession().stage).toBe("listening");
  expect(takeVoiceLauncher()).toBe(header);
  expect(takeVoiceLauncher()).toBeNull();
});
