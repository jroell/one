import { useLayoutEffect, useRef } from "react";

import { useSidebar } from "~/components/ui/sidebar";

import { useWorkspaceMode, type WorkspaceMode } from "./workspaceMode";

/** Below this the screen has no room to spare, so Chat leaves the sidebar as the person had it. */
const WIDE_QUERY = "(min-width: 1100px)";

const prefKey = (mode: WorkspaceMode) => `one:sidebar-open:${mode}`;

function readPref(mode: WorkspaceMode): boolean | null {
  try {
    const value = window.localStorage.getItem(prefKey(mode));
    return value === "true" ? true : value === "false" ? false : null;
  } catch {
    return null;
  }
}

function writePref(mode: WorkspaceMode, open: boolean) {
  try {
    window.localStorage.setItem(prefKey(mode), String(open));
  } catch {
    // Storage can be unavailable (private windows); the sidebar still works for this session.
  }
}

/**
 * Each mode keeps its own sidebar: Chat opens with it collapsed on a wide screen, so the
 * conversation has the room, and Code keeps what the person had. Whatever the person does with the
 * sidebar in a mode is remembered for that mode and wins from then on.
 */
function useModeSidebar(): void {
  const mode = useWorkspaceMode();
  const { open, setOpen, isMobile } = useSidebar();
  const appliedMode = useRef<WorkspaceMode | null>(null);
  // Set when this hook moves the sidebar, so that move is not recorded as the person's choice.
  const ownMove = useRef(false);
  const seenOpen = useRef(open);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies the new mode's sidebar before paint, so the layout never shows the old mode's sidebar for a frame
  useLayoutEffect(() => {
    if (isMobile || appliedMode.current === mode) return;
    const previous = appliedMode.current;
    appliedMode.current = mode;
    // What Code looked like is kept the first time it is left, so Chat's default cannot overwrite it.
    if (previous !== null && readPref(previous) === null) writePref(previous, open);
    if (previous === null && mode === "chat" && readPref("code") === null) writePref("code", open);
    const wide = window.matchMedia(WIDE_QUERY).matches;
    const target = readPref(mode) ?? (mode === "chat" && wide ? false : null);
    if (target !== null && target !== open) {
      ownMove.current = true;
      setOpen(target);
    }
  }, [mode, isMobile, open, setOpen]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the person's own open or close for the mode they are in
  useLayoutEffect(() => {
    if (open === seenOpen.current) return;
    seenOpen.current = open;
    if (isMobile || appliedMode.current === null) return;
    if (ownMove.current) {
      ownMove.current = false;
      return;
    }
    writePref(appliedMode.current, open);
  }, [open, isMobile]);
}

/** Mounts the per-mode sidebar rule inside the sidebar provider. It draws nothing. */
export function ModeSidebar() {
  useModeSidebar();
  return null;
}
