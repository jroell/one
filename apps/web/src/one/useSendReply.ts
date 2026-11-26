import { useContext } from "react";

import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { toastManager } from "~/components/ui/toast";

import { guidedConversationReason, useSendGuidedMessage } from "./startConversation";

/**
 * Sends a short reply as the person's own message in the thread these buttons are shown in, with
 * nothing hidden beside it.
 */
export function useSendReply(): (text: string) => void {
  const send = useSendGuidedMessage();
  const shownThreadKey = useContext(TimelineRowCtx)?.routeThreadKey;
  return (text) => {
    void send({ visibleText: text, expectThreadKey: shownThreadKey }).then((result) => {
      if (result.ok) return;
      toastManager.add({
        type: "info",
        title: result.detail ?? guidedConversationReason(result.reason),
      });
    });
  };
}
