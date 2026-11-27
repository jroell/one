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

/** How long the old layout takes to leave and the new one to arrive. They never overlap. */
const LEAVE_MS = 80;
const ARRIVE_MS = 140;

/**
 * What differs between the modes: the conversation and composer under the header, and anything
 * beside the chat column. The sidebar, the header bar and the mode toggle are the same in both, so
 * they never fade. A page with no chat column (Settings, Home) has nothing to fade.
 */
function pageLayers(): HTMLElement[] {
  const column = document.querySelector<HTMLElement>("[data-chat-column]");
  if (column === null) return [];
  const beside = column.parentElement ? [...column.parentElement.children] : [];
  return [...column.children, ...beside.filter((element) => element !== column)].filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && !element.matches("[data-chat-header]"),
  );
}

/** What the switch is animating now, so a second switch can take over from where it stands. */
let running: Animation[] = [];

function stopRunning(): void {
  for (const animation of running) animation.cancel();
  running = [];
}

function fade(
  layers: readonly HTMLElement[],
  from: number,
  to: number,
  duration: number,
  easing: string,
): Promise<unknown> {
  const animations = layers.map((layer) =>
    layer.animate([{ opacity: from }, { opacity: to }], { duration, easing, fill: "both" }),
  );
  running.push(...animations);
  return Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
}

/**
 * Switches the mode at once. With `transition`, the conversation and composer fade out (80ms) while
 * the mode changes underneath, then fade in (140ms): the same live elements throughout, opacity
 * only, so no frame holds two layouts. The sidebar and header stay put. A quick second switch lands
 * on the last mode asked.
 */
export function setWorkspaceMode(
  mode: WorkspaceMode,
  options: { readonly transition?: boolean } = {},
): void {
  const layers = options.transition === true ? pageLayers() : [];
  const crossFade =
    layers.length > 0 &&
    typeof Element.prototype.animate === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!crossFade) {
    requestedMode = mode;
    commit(mode);
    return;
  }
  if (mode === requestedMode) return;
  requestedMode = mode;
  const token = ++lastTransition;
  // A switch already running hands over from the opacity it reached.
  const startOpacity =
    running.length === 0 ? 1 : Number.parseFloat(getComputedStyle(layers[0]!).opacity);
  stopRunning();
  document.documentElement.dataset.oneModeTransition = String(token);
  const leaving = fade(layers, startOpacity, 0, LEAVE_MS * startOpacity, "linear");
  // The change is the slow part (the page restyles), and it blocks the main thread. The fade-out
  // runs on the compositor and carries on through it, so the old page keeps fading while the new
  // one is built; once built, it stays hidden until it fades in.
  commit(mode);
  for (const animation of running) animation.finish();
  void leaving.then(() => {
    if (token !== lastTransition) return;
    stopRunning();
    return fade(pageLayers(), 0, 1, ARRIVE_MS, "cubic-bezier(0.2, 0.9, 0.1, 1)").then(() => {
      if (token !== lastTransition) return;
      stopRunning();
      clearTransitionMarker(token);
    });
  });
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
