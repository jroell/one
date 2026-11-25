import type { ScopedThreadRef } from "@t3tools/contracts";

import { selectThreadPanelOpen, useRightPanelStore } from "../rightPanelStore";
import type { ThreadPanelPresentation } from "../rightPanelLayout";
import { useWorkspaceMode } from "./workspaceMode";

/**
 * Chat mode has no inline thread details card: the header control and the command open the
 * popover at every width. Everything that reads the card's state (the canvas reservation, both
 * header variants) takes it from here, so none can disagree about which card is showing.
 */
function resolveThreadPanelView(input: {
  readonly chatMode: boolean;
  /** What the canvas measurements would pick when the card is allowed inline. */
  readonly canvasPresentation: ThreadPanelPresentation;
  readonly inlineOpen: boolean;
  readonly popoverOpen: boolean;
}): { readonly presentation: ThreadPanelPresentation; readonly open: boolean } {
  const presentation = input.chatMode ? "popover" : input.canvasPresentation;
  return { presentation, open: presentation === "popover" ? input.popoverOpen : input.inlineOpen };
}

/** Whether the inline card is open and may reserve room on the canvas. Never in Chat mode. */
export function useThreadPanelInlineOpen(threadRef: ScopedThreadRef | null): boolean {
  const chatMode = useWorkspaceMode() === "chat";
  const inlineOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, threadRef, "inline"),
  );
  return !chatMode && inlineOpen;
}

/** The presentation and open state both header variants show. */
export function useThreadPanelView(
  threadRef: ScopedThreadRef | null,
  canvasPresentation: ThreadPanelPresentation,
) {
  const chatMode = useWorkspaceMode() === "chat";
  const inlineOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, threadRef, "inline"),
  );
  const popoverOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, threadRef, "popover"),
  );
  return resolveThreadPanelView({ chatMode, canvasPresentation, inlineOpen, popoverOpen });
}
