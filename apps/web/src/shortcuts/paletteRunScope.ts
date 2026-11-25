import { useCommandPaletteStore } from "../commandPaletteStore";
import type { CommandRunContext } from "./commandRegistry";

let opener: HTMLElement | null = null;

// The palette's own state change happens before React moves focus into the popup, so the active
// element at that moment is where the user was.
useCommandPaletteStore.subscribe((state, previous) => {
  if (!state.open || previous.open) return;
  const active = document.activeElement;
  opener =
    active instanceof HTMLElement &&
    active !== document.body &&
    !active.closest("[data-command-palette]")
      ? active
      : null;
});

/** What a palette row passes to the command it runs: the element focused when the palette opened. */
export function readPaletteRunContext(): CommandRunContext {
  return { opener: opener?.isConnected ? opener : null };
}

/** Where the user is: the route (path, search and hash) and the thread it shows. */
export interface RunScopeSource {
  readonly readLocation: () => string;
  readonly readThreadKey: () => string | null;
  /** Calls the listener at every route or thread change; returns the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void;
}

// A hash history (the desktop app) keeps the route in the hash; a browser history keeps it in the path.
const windowSource: RunScopeSource = {
  readLocation: () => `${window.location.pathname}${window.location.search}${window.location.hash}`,
  readThreadKey: () => null,
  subscribe: (listener) => {
    window.addEventListener("popstate", listener);
    window.addEventListener("hashchange", listener);
    return () => {
      window.removeEventListener("popstate", listener);
      window.removeEventListener("hashchange", listener);
    };
  },
};

let source: RunScopeSource = windowSource;

/** The chat route says where the user is and when that changes, so a queued command can tell. */
export function setRunScopeSource(next: RunScopeSource): () => void {
  source = next;
  return () => {
    if (source === next) source = windowSource;
  };
}

export interface RunScope {
  /** False from the first route or thread change on, even if the user came back. */
  readonly isValid: () => boolean;
  readonly dispose: () => void;
}

/**
 * Remembers the route and thread the user was on and watches for the first change, so a command
 * queued behind the palette's closing animation does not run elsewhere, even after a trip A to B
 * to A. The caller disposes it once the command ran or was dropped.
 */
export function captureRunScope(): RunScope {
  const scope = source;
  const location = scope.readLocation();
  const threadKey = scope.readThreadKey();
  let changed = false;
  const check = () => {
    if (scope.readLocation() !== location || scope.readThreadKey() !== threadKey) changed = true;
  };
  const unsubscribe = scope.subscribe(check);
  return {
    isValid: () => {
      check();
      return !changed;
    },
    dispose: unsubscribe,
  };
}
