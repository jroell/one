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

function getWorkspaceMode(): WorkspaceMode {
  return currentMode;
}

function commit(mode: WorkspaceMode) {
  currentMode = mode;
  applyToDocument(mode);
  try {
    window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable (private windows); the mode still applies for this session.
  }
  for (const listener of listeners) listener();
}

/** Switches the mode. Where the browser supports it, the two layouts cross-fade. */
export function setWorkspaceMode(mode: WorkspaceMode): void {
  if (mode === currentMode) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion || typeof document.startViewTransition !== "function") {
    commit(mode);
    return;
  }
  document.documentElement.dataset.oneModeTransition = "";
  const transition = document.startViewTransition(() => commit(mode));
  void transition.finished.finally(() => {
    delete document.documentElement.dataset.oneModeTransition;
  });
}

export function toggleWorkspaceMode(): void {
  setWorkspaceMode(currentMode === "chat" ? "code" : "chat");
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== WORKSPACE_MODE_STORAGE_KEY) return;
    const next = parseWorkspaceMode(event.newValue);
    if (next === currentMode) return;
    currentMode = next;
    applyToDocument(next);
    for (const each of listeners) each();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useWorkspaceMode(): WorkspaceMode {
  return useSyncExternalStore(subscribe, getWorkspaceMode, () => "code" as const);
}
