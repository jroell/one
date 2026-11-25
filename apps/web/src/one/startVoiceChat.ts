import { msg } from "gt-react";

import { toastManager } from "~/components/ui/toast";
import { m } from "~/i18n/messages";
import type { VoiceBridge } from "./voiceBridge";
import { dispatchVoiceSession } from "./voiceSession";

/**
 * Opens voice chat on the composer's thread. A spoken question is sent on its
 * own, so an unfinished draft has to be sent or cleared first.
 */
export function startVoiceChat(voice: VoiceBridge): void {
  if (!voice.draftEmpty) {
    toastManager.add({
      type: "info",
      title: m(msg("Send or clear your draft first")),
      description: m(msg("Voice chat sends what you say on its own, without the draft.")),
    });
    return;
  }
  dispatchVoiceSession({ type: "start", threadKey: voice.threadKey });
}
