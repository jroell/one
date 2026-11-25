import { msg } from "gt-react";

import { toastManager } from "~/components/ui/toast";
import { m } from "~/i18n/messages";
import { getVoiceBridge, type VoiceBridge } from "./voiceBridge";
import { dispatchVoiceSession, getVoiceSession } from "./voiceSession";
import { getWorkspaceMode, setWorkspaceMode } from "./workspaceMode";

/**
 * Opens voice chat on the composer's thread. A spoken question is sent on its
 * own, so an unfinished draft has to be sent or cleared first.
 */
export function startVoiceChat(voice: VoiceBridge): void {
  // A dictation already under way belongs to the editor; voice chat must not take it over and send it.
  // A recorder stopped by an error is nobody's: the new conversation clears it and starts fresh.
  if (voice.phase !== "idle" && voice.phase !== "error") return;
  if (!voice.draftEmpty) {
    toastManager.add({
      type: "info",
      title: m(msg("Send or clear your draft first")),
      description: m(msg("Voice chat sends what you say on its own, without the draft.")),
    });
    return;
  }
  if (voice.needsSetup) {
    // One notice per attempt: the stable id makes a second click update this toast, not stack another.
    toastManager.add({
      id: "voice-chat-needs-transcription",
      type: "info",
      title: m(msg("Voice chat needs a transcription source")),
      description: m(msg("Choose one under Transcribe with, then start voice chat again.")),
    });
    // Starting without a source opens Voice settings at the transcription row; there is nothing to listen to yet.
    voice.start();
    return;
  }
  if (voice.phase === "error") voice.cancel();
  dispatchVoiceSession({ type: "start", threadKey: voice.threadKey, isDraft: voice.isDraft });
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
    toastManager.add({
      type: "info",
      title: m(msg("Voice chat is not available here")),
      description: m(msg("Open a thread you can write in and set up voice input in Settings.")),
    });
    return;
  }
  if (getWorkspaceMode() !== "chat") setWorkspaceMode("chat");
  startVoiceChat(voice);
}
