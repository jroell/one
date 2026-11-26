import { expect, it, vi } from "vite-plus/test";

import { toastManager } from "~/components/ui/toast";

import { startVoiceChat, toggleVoiceChat } from "./startVoiceChat";
import { publishVoiceBridge, retractVoiceBridge, type VoiceBridge } from "./voiceBridge";
import { dispatchVoiceSession, getVoiceSession } from "./voiceSession";
import { takeVoiceLauncher } from "./voiceStageMotion";

function bridge(overrides: Partial<VoiceBridge> = {}): VoiceBridge {
  return {
    threadKey: "thread-a",
    isDraft: false,
    continuesDraft: () => false,
    available: true,
    needsSetup: false,
    openSetup: () => undefined,
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

/** What the person is shown: the notice's words and the one control it offers. */
function shownNotice() {
  const add = vi.spyOn(toastManager, "add").mockImplementation(() => "");
  const close = vi.spyOn(toastManager, "close").mockImplementation(() => undefined);
  return {
    add,
    close,
    last: () => {
      const options = add.mock.calls.at(-1)?.[0];
      const action = (options?.actionProps ?? undefined) as
        | { children?: unknown; onClick?: () => void }
        | undefined;
      return { title: options?.title, description: options?.description, action };
    },
    [Symbol.dispose]: () => {
      add.mockRestore();
      close.mockRestore();
    },
  };
}

it("the shortcut with transcription off says why and opens Voice settings from the notice", () => {
  using notice = shownNotice();
  let opened = 0;
  publishVoiceBridge("toggle", {
    ...bridge({ available: false, openSetup: () => void (opened += 1) }),
  });
  using _bridge = { [Symbol.dispose]: () => retractVoiceBridge("toggle") };

  toggleVoiceChat();

  const { title, description, action } = notice.last();
  expect(title).toBe("Voice chat is not available here");
  expect(description).toBe("Voice input is not set up for this conversation.");
  expect(action?.children).toBe("Open Voice settings");
  action?.onClick?.();
  expect(opened).toBe(1);
  // Pressing it also dismisses the notice, which has done its job.
  expect(notice.close).toHaveBeenCalledWith("voice-chat-not-available");
});

it("the shortcut with no conversation open says what voice chat needs and offers no control it could not use", () => {
  using notice = shownNotice();

  toggleVoiceChat();

  const { description, action } = notice.last();
  expect(description).toBe("Voice chat works inside a conversation you can write in.");
  expect(action).toBeUndefined();
});
