import { expect, it, vi } from "vite-plus/test";

import { toastManager } from "~/components/ui/toast";

import { startVoiceChat, toggleVoiceChat } from "./startVoiceChat";
import {
  publishVoiceBridge,
  resolveVoiceOffer,
  retractVoiceBridge,
  type VoiceBridge,
} from "./voiceBridge";
import { dispatchVoiceSession, getVoiceSession } from "./voiceSession";
import { takeVoiceLauncher } from "./voiceStageMotion";
import { getWorkspaceMode, setWorkspaceMode } from "./workspaceMode";

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

/** The bridge the composer publishes, from the same rule it uses, for a given transcription setting. */
function composerBridge(
  setting: "off" | "never-chosen" | "on",
  overrides: Partial<VoiceBridge> = {},
) {
  const offer = resolveVoiceOffer({
    composerFree: true,
    speechAvailable: setting !== "off",
    grantId: setting === "on" ? "grant-1" : null,
    offerFirstRunSetup: setting === "never-chosen",
    off: setting === "off",
  });
  return bridge({ ...offer, ...overrides });
}

it.each(["off", "never-chosen"] as const)(
  "pressing the voice shortcut with transcription %s says why and opens Voice settings from the notice",
  (setting) => {
    using notice = shownNotice();
    let opened = 0;
    publishVoiceBridge("toggle", composerBridge(setting, { openSetup: () => void (opened += 1) }));
    using _bridge = { [Symbol.dispose]: () => retractVoiceBridge("toggle") };

    toggleVoiceChat();

    const { title, description, action } = notice.last();
    expect(title).toBe("Voice input is off");
    expect(description).toBe("Choose where your speech is turned into text.");
    expect(action?.children).toBe("Open Voice settings");
    expect(getVoiceSession().stage).toBe("off");
    action?.onClick?.();
    expect(opened).toBe(1);
    // Pressing it also dismisses the notice, which has done its job.
    expect(notice.close).toHaveBeenCalledWith("voice-chat-needs-transcription");
  },
);

it("the shortcut with a conversation that cannot offer voice chat says so and still offers the setting", () => {
  using notice = shownNotice();
  let opened = 0;
  publishVoiceBridge("toggle", bridge({ available: false, openSetup: () => void (opened += 1) }));
  using _bridge = { [Symbol.dispose]: () => retractVoiceBridge("toggle") };

  toggleVoiceChat();

  const { title, description, action } = notice.last();
  expect(title).toBe("Voice chat is not available here");
  expect(description).toBe("Voice input is not set up for this conversation.");
  action?.onClick?.();
  expect(opened).toBe(1);
});

it("a refused shortcut leaves Code mode as it is, and an allowed one switches to Chat mode", () => {
  using notice = shownNotice();
  using _session = { [Symbol.dispose]: () => dispatchVoiceSession({ type: "stop" }) };
  using _bridge = { [Symbol.dispose]: () => retractVoiceBridge("toggle") };
  using _mode = { [Symbol.dispose]: () => setWorkspaceMode("code") };
  setWorkspaceMode("code");

  for (const refused of [
    composerBridge("off"),
    composerBridge("on", { draftEmpty: false }),
    composerBridge("on", { phase: "recording" }),
  ]) {
    publishVoiceBridge("toggle", refused);
    toggleVoiceChat();
    expect(getWorkspaceMode()).toBe("code");
    expect(getVoiceSession().stage).toBe("off");
  }
  expect(notice.add).toHaveBeenCalledTimes(2);

  publishVoiceBridge("toggle", composerBridge("on"));
  toggleVoiceChat();
  expect(getWorkspaceMode()).toBe("chat");
  expect(getVoiceSession().stage).toBe("listening");
});

it("the composer's rule offers voice chat with transcription off, and needs setup only when no source is chosen", () => {
  const offer = (input: Partial<Parameters<typeof resolveVoiceOffer>[0]>) =>
    resolveVoiceOffer({
      composerFree: true,
      speechAvailable: false,
      grantId: null,
      offerFirstRunSetup: false,
      off: false,
      ...input,
    });
  expect(offer({ off: true })).toEqual({ available: true, needsSetup: true });
  expect(offer({ offerFirstRunSetup: true, speechAvailable: true })).toEqual({
    available: true,
    needsSetup: true,
  });
  expect(offer({ grantId: "g", speechAvailable: true })).toEqual({
    available: true,
    needsSetup: false,
  });
  // A busy composer offers nothing, off or not.
  expect(offer({ off: true, composerFree: false })).toEqual({ available: false, needsSetup: true });
  // Nothing set up and nothing chosen, as in a window that cannot record: not offered.
  expect(offer({})).toEqual({ available: false, needsSetup: false });
});

it("the shortcut with no conversation open says what voice chat needs and offers no control it could not use", () => {
  using notice = shownNotice();

  toggleVoiceChat();

  const { description, action } = notice.last();
  expect(description).toBe("Voice chat works inside a conversation you can write in.");
  expect(action).toBeUndefined();
});
