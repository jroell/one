import { useSyncExternalStore } from "react";

/**
 * How the workspace presents a thread. "code" is the full coding workspace.
 * "chat" is a calmer reading layout for learning, brainstorming and voice.
 * The mode is a view choice on this device: it never changes a thread.
 */
export type WorkspaceMode = "code" | "chat";

const WORKSPACE_MODE_STORAGE_KEY = "one:workspace-mode";

const listeners = new Set<() => void>();

export function parseWorkspaceMode(value: unknown): WorkspaceMode {
  return value === "chat" ? "chat" : "code";
}

function readStoredMode(): WorkspaceMode {
  try {
    return parseWorkspaceMode(window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY));
  } catch {
    return "code";
  }
}

let currentMode: WorkspaceMode = typeof window === "undefined" ? "code" : readStoredMode();

function applyToDocument(mode: WorkspaceMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.oneMode = mode;
}

applyToDocument(currentMode);

export function getWorkspaceMode(): WorkspaceMode {
  return currentMode;
}

function store(mode: WorkspaceMode) {
  currentMode = mode;
  try {
    window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable (private windows); the mode still applies for this session.
  }
  for (const listener of listeners) listener();
}

/**
 * Switches the mode. The choice takes effect at once, so a quick second
 * switch always lands on the last one chosen; where the browser supports it,
 * the two layouts cross-fade.
 */
export function setWorkspaceMode(mode: WorkspaceMode): void {
  if (mode === currentMode) return;
  store(mode);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion || typeof document.startViewTransition !== "function") {
    applyToDocument(currentMode);
    return;
  }
  document.documentElement.dataset.oneModeTransition = "";
  // The layout follows whichever mode is current when the browser is ready to swap.
  const transition = document.startViewTransition(() => applyToDocument(currentMode));
  const settle = () => {
    applyToDocument(currentMode);
    delete document.documentElement.dataset.oneModeTransition;
  };
  // A second switch skips this cross-fade; the browser reports that as a rejection, which is expected.
  transition.ready.catch(() => {});
  transition.finished.then(settle, settle);
}

export function toggleWorkspaceMode(): void {
  setWorkspaceMode(currentMode === "chat" ? "code" : "chat");
}

// Each window keeps its own mode while it is open. The stored value only decides how
// the next window starts, so switching modes in one window never changes another
// (which would, for example, end a voice chat running there).
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaceMode(): WorkspaceMode {
  return useSyncExternalStore(subscribe, getWorkspaceMode, () => "code" as const);
}
