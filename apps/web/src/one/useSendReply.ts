import { useContext } from "react";

import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { toastManager } from "~/components/ui/toast";

import { guidedConversationReason, useSendGuidedMessage } from "./startConversation";

/**
 * Sends a short reply as the person's own message in the thread these buttons are shown in, with
 * nothing hidden beside it. Resolves true once the server accepted it.
 */
export function useSendReply(): (text: string) => Promise<boolean> {
  const send = useSendGuidedMessage();
  const shownThreadKey = useContext(TimelineRowCtx)?.routeThreadKey;
  return async (text) => {
    const result = await send({ visibleText: text, expectThreadKey: shownThreadKey });
    if (!result.ok) {
      toastManager.add({
        type: "info",
        title: result.detail ?? guidedConversationReason(result.reason),
      });
    }
    return result.ok;
  };
}
