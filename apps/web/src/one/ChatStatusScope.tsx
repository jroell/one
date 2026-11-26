import { useId, type ReactNode } from "react";

import { ChatStatusScopeContext } from "./chatStatus";

/** Gives a chat view its own header status: what it publishes reaches only its own dot. */
export function ChatStatusScope({ children }: { readonly children: ReactNode }) {
  const scope = useId();
  return <ChatStatusScopeContext value={scope}>{children}</ChatStatusScopeContext>;
}
