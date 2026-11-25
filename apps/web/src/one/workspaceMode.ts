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

/** The last mode asked for. While a cross-fade is pending it is ahead of `currentMode`. */
let requestedMode: WorkspaceMode = currentMode;
/** Numbers the cross-fades, so each one clears only its own marker. */
let lastTransition = 0;

/** The mode the layout shows now. */
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

/** Chat mode hides the inline thread details card, so focus inside it moves to the mode switch. */
function keepFocusOutOfHiddenDetails(mode: WorkspaceMode) {
  if (mode !== "chat") return;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.closest('[data-thread-details-panel="inline"]'))
    return;
  document
    .querySelector<HTMLElement>('[data-one-mode-switch] [data-mode="chat"]')
    ?.focus({ preventScroll: true });
}

/** The layout and the store change in one update, so React never shows a mode the page does not. */
function commit(mode: WorkspaceMode) {
  keepFocusOutOfHiddenDetails(mode);
  applyToDocument(mode);
  if (mode !== currentMode) store(mode);
}

function clearTransitionMarker(token: number) {
  if (document.documentElement.dataset.oneModeTransition === String(token)) {
    delete document.documentElement.dataset.oneModeTransition;
  }
}

/**
 * Switches the mode at once. With `transition`, the layouts cross-fade where the browser allows,
 * and the store and page change together when it swaps, so code that needs the mode straight away
 * (voice chat starting) must not ask for one. A quick second switch lands on the last mode chosen.
 */
export function setWorkspaceMode(
  mode: WorkspaceMode,
  options: { readonly transition?: boolean } = {},
): void {
  const crossFade =
    options.transition === true &&
    typeof document.startViewTransition === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!crossFade) {
    requestedMode = mode;
    commit(mode);
    return;
  }
  if (mode === requestedMode) return;
  requestedMode = mode;
  const token = ++lastTransition;
  document.documentElement.dataset.oneModeTransition = String(token);
  // The swap follows whichever mode was asked for last when the browser is ready for it.
  const swap = () => commit(requestedMode);
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(swap);
  } catch {
    // The browser refused the cross-fade: switch without one, and leave no marker behind.
    swap();
    clearTransitionMarker(token);
    return;
  }
  const settle = () => {
    swap();
    clearTransitionMarker(token);
  };
  // A second switch skips this cross-fade; the browser reports that as a rejection, which is expected.
  transition.ready.catch(() => {});
  transition.finished.then(settle, settle);
}

/** Flips the mode from the one asked for last, so two quick flips end where they started. */
export function toggleWorkspaceMode(): WorkspaceMode {
  const next = requestedMode === "chat" ? "code" : "chat";
  setWorkspaceMode(next, { transition: true });
  return next;
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
