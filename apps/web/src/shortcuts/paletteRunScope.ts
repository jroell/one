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

let readActiveThreadKey: () => string | null = () => null;

/** The chat route says which thread is showing, so a queued command can tell it changed. */
export function setActiveThreadKeyReader(read: () => string | null): () => void {
  readActiveThreadKey = read;
  return () => {
    if (readActiveThreadKey === read) readActiveThreadKey = () => null;
  };
}

// A hash history (the desktop app) keeps the route in the hash; a browser history keeps it in the path.
const routeLocation = () =>
  `${window.location.pathname}${window.location.search}${
    window.location.hash.startsWith("#/") ? window.location.hash : ""
  }`;

/**
 * Remembers the route and thread the user was on. The returned check is false once either has
 * changed, so a command queued behind the palette's closing animation does not run elsewhere.
 */
export function captureRunScope(): () => boolean {
  const location = routeLocation();
  const threadKey = readActiveThreadKey();
  return () => routeLocation() === location && readActiveThreadKey() === threadKey;
}
