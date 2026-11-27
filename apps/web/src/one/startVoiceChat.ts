import { msg } from "gt-react";

import { toastManager } from "~/components/ui/toast";
import { m } from "~/i18n/messages";
import { getVoiceBridge, type VoiceBridge } from "./voiceBridge";
import { dispatchVoiceSession, getVoiceSession } from "./voiceSession";
import { rememberVoiceLauncher } from "./voiceStageMotion";
import { getWorkspaceMode, setWorkspaceMode } from "./workspaceMode";

/** The notice's button: goes to the setting, and the notice, its job done, goes away. */
export function openVoiceSettings(voice: VoiceBridge, noticeId: string): void {
  toastManager.close(noticeId);
  voice.openSetup();
}

/**
 * Opens voice chat on the composer's thread. A spoken question is sent on its
 * own, so an unfinished draft has to be sent or cleared first.
 */
export function startVoiceChat(voice: VoiceBridge, origin: Element | null = null): void {
  if (explainRefusal(voice)) return;
  // The ring flies in from the control that opened this conversation, and from nothing else: a
  // start that was refused never reaches here, so it cannot leave its button behind.
  rememberVoiceLauncher(origin);
  dispatchVoiceSession({ type: "start", threadKey: voice.threadKey, isDraft: voice.isDraft });
}

/**
 * Why voice chat cannot start from this composer, said to the person, or false when it can. The
 * keyboard way checks this before it changes anything on screen.
 */
function explainRefusal(voice: VoiceBridge): boolean {
  // A dictation already under way belongs to the editor; voice chat must not take it over and send it.
  // A recorder stopped by an error is nobody's: the new conversation clears it and starts fresh.
  if (voice.phase !== "idle" && voice.phase !== "error") return true;
  if (!voice.draftEmpty) {
    toastManager.add({
      type: "info",
      title: m(msg("Send or clear your draft first")),
      description: m(msg("Voice chat sends what you say on its own, without the draft.")),
    });
    return true;
  }
  if (voice.needsSetup) {
    // One notice per attempt: the stable id makes a second click update this toast, not stack another.
    // The words hold whether transcription was turned off or never chosen.
    toastManager.add({
      id: "voice-chat-needs-transcription",
      type: "info",
      title: m(msg("Voice input is off")),
      description: m(msg("Choose where your speech is turned into text.")),
      actionProps: {
        children: m(msg("Open Voice settings")),
        onClick: () => openVoiceSettings(voice, "voice-chat-needs-transcription"),
      },
    });
    return true;
  }
  if (voice.phase === "error") voice.cancel();
  return false;
}

/**
 * The keyboard way in and out of voice chat. Starting it from Code mode
 * switches to Chat mode first, because that is where voice chat lives.
 */
export function toggleVoiceChat(): void {
  if (getVoiceSession().stage !== "off") {
    dispatchVoiceSession({ type: "stop" });
    return;
  }
  const voice = getVoiceBridge();
  if (!voice?.available) {
    // Without a conversation there is nothing to open; with one, the setting is the way out.
    toastManager.add({
      id: "voice-chat-not-available",
      type: "info",
      title: m(msg("Voice chat is not available here")),
      description: voice
        ? m(msg("Voice input is not set up for this conversation."))
        : m(msg("Voice chat works inside a conversation you can write in.")),
      ...(voice
        ? {
            actionProps: {
              children: m(msg("Open Voice settings")),
              onClick: () => openVoiceSettings(voice, "voice-chat-not-available"),
            },
          }
        : {}),
    });
    return;
  }
  // A refusal is said where the person is: Code mode stays Code mode.
  if (explainRefusal(voice)) return;
  if (getWorkspaceMode() !== "chat") setWorkspaceMode("chat");
  startVoiceChat(voice);
}
