import { useContext } from "react";

import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { toastManager } from "~/components/ui/toast";
import { m } from "~/i18n/messages";

import { QUIZ_INSTRUCTIONS, QUIZ_REQUEST, QUIZ_ROUND_REQUEST } from "./chatQuiz";
import { guidedConversationReason, useSendGuidedMessage } from "./startConversation";

/**
 * Asks for a quiz in the thread on screen. The person's message is the short line they see; the
 * format the reply must take is sent beside it, out of sight, through the one guided path.
 */
export function useAskForQuiz(kind: "first" | "round"): () => void {
  const send = useSendGuidedMessage();
  // The buttons may sit in a side pane; the message goes only to the thread they are shown in.
  const shownThreadKey = useContext(TimelineRowCtx)?.routeThreadKey;
  return () => {
    void send({
      visibleText: m(kind === "first" ? QUIZ_REQUEST : QUIZ_ROUND_REQUEST),
      hiddenContext: QUIZ_INSTRUCTIONS,
      expectThreadKey: shownThreadKey,
    }).then((result) => {
      if (result.ok) return;
      toastManager.add({
        type: "info",
        title: result.detail ?? guidedConversationReason(result.reason),
      });
    });
  };
}
