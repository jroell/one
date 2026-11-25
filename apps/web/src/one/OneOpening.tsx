import { useGT } from "gt-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { OneOrb, OPENING_SECONDS } from "./OneOrb";
import { getOpeningPreferences, onReplayOpening, OPENING_SEEN_KEY } from "./openingPreferences";
import { playOpeningSound } from "./openingSound";

/** The ring ignites, the title holds for a moment, then the app is revealed. */
// The name finishes arriving about 3.7s in; it then stays readable before the cover lifts.
const HOLD_MS = OPENING_SECONDS * 1000 + 1600;
const LEAVE_MS = 460;

/** Once per app session, and never for people who turned it off or prefer reduced motion. */
function shouldPlayOpening(): boolean {
  if (typeof window === "undefined" || !getOpeningPreferences().animation) return false;
  try {
    if (window.sessionStorage.getItem(OPENING_SEEN_KEY) !== null) return false;
  } catch {
    // Without session storage the opening simply plays on every load.
  }
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Phase = "playing" | "leaving" | "done";

/**
 * The opening: out of black, a line of fire runs around the ring, the metal
 * resolves behind it, and the name appears. Any key or click skips it.
 */
export function OneOpening() {
  const gt = useGT();
  const [phase, setPhase] = useState<Phase>(() => (shouldPlayOpening() ? "playing" : "done"));
  /** Counts plays, so a replay mounts a fresh ring that ignites again. */
  const [play, setPlay] = useState(0);
  const coverRef = useRef<HTMLDivElement | null>(null);
  const skipRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the opening's timers, sound and skip listeners, all outside React, while the overlay is up
  useEffect(() => {
    // The key dispatcher runs no command while the attribute is set, so a key that skips the
    // opening cannot also run a command. A replay from Settings sets it again.
    if (phase === "playing") document.documentElement.dataset.oneOpening = "";
    else delete document.documentElement.dataset.oneOpening;
    // "Armed" tells index.html a cover is mounted and listening, so it may take the skipping key
    // or click. "Cover" lasts through the fade, so the app's own ring waits for this one to go.
    if (phase === "playing") document.documentElement.dataset.oneOpeningArmed = "";
    else delete document.documentElement.dataset.oneOpeningArmed;
    if (phase === "done") delete document.documentElement.dataset.oneOpeningCover;
    else document.documentElement.dataset.oneOpeningCover = "";
    if (phase === "done") return;
    if (phase === "leaving") {
      // The app is usable again as soon as the cover starts to fade, so focus returns now, not
      // when the fade ends. A control the user has focused since is left alone.
      const opener = openerRef.current;
      openerRef.current = null;
      const active = document.activeElement;
      const focusLost = !active || active === document.body || coverRef.current?.contains(active);
      if (opener?.isConnected && focusLost) opener.focus();
      const timer = window.setTimeout(() => setPhase("done"), LEAVE_MS);
      return () => window.clearTimeout(timer);
    }
    try {
      window.sessionStorage.setItem(OPENING_SEEN_KEY, "1");
    } catch {
      // Without session storage the opening simply plays again next load.
    }
    // After a replay from Settings, focus goes back to the button that started it.
    openerRef.current =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    // The cover hides the app, so everything else (the app root and portaled dialogs such as
    // Settings) takes no focus, keys or clicks until it lifts. Only what this changes is restored.
    const cover = coverRef.current;
    const locked = new Set<HTMLElement>();
    const lock = (node: Node | null) => {
      if (!(node instanceof HTMLElement) || node === cover || node.inert) return;
      node.inert = true;
      locked.add(node);
    };
    for (const child of Array.from(document.body.children)) lock(child);
    lock(document.getElementById("root"));
    const portals = new MutationObserver((records) => {
      for (const record of records) for (const added of record.addedNodes) lock(added);
    });
    portals.observe(document.body, { childList: true });
    skipRef.current?.focus();
    let stopSound = () => {};
    try {
      if (getOpeningPreferences().sound) stopSound = playOpeningSound(OPENING_SECONDS);
    } catch {
      // The opening plays silently when the browser refuses audio.
    }
    const leave = () => {
      stopSound();
      setPhase("leaving");
    };
    const timer = window.setTimeout(leave, HOLD_MS);
    // Any key or click lifts the cover, and that key or click goes no further, not even to the
    // other listeners on the window.
    const skip = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      leave();
    };
    window.addEventListener("keydown", skip, { once: true, capture: true });
    window.addEventListener("pointerdown", skip, { once: true, capture: true });
    // index.html listens before every other window listener and takes the skipping key or click
    // for itself, so no listener that was registered before this one can act on it.
    window.addEventListener("one:opening-skip", leave, { once: true });
    return () => {
      // However this effect ends (skip, timeout, unmount, hot reload), the app must be usable again.
      delete document.documentElement.dataset.oneOpening;
      delete document.documentElement.dataset.oneOpeningArmed;
      portals.disconnect();
      for (const node of locked) node.inert = false;
      window.clearTimeout(timer);
      stopSound();
      window.removeEventListener("keydown", skip, { capture: true });
      window.removeEventListener("pointerdown", skip, { capture: true });
      window.removeEventListener("one:opening-skip", leave);
    };
  }, [phase]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for the "play it now" request from Settings, which lives outside this tree
  useEffect(
    () =>
      onReplayOpening(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        setPlay((count) => count + 1);
        setPhase("playing");
      }),
    [],
  );

  if (phase === "done") return null;
  // Outside the app root, which is inert while the cover is up. Once it starts to fade it is
  // no longer a modal dialog: the app behind it is live, so the cover leaves the tree and the focus order.
  return createPortal(
    <div
      ref={coverRef}
      className="one-opening"
      data-phase={phase}
      role="dialog"
      aria-modal={phase === "playing" ? "true" : undefined}
      aria-hidden={phase === "leaving" ? "true" : undefined}
      inert={phase === "leaving"}
      aria-label={gt("One is opening")}
    >
      <OneOrb key={play} opening className="one-opening-ring" />
      <p className="one-opening-name">One</p>
      <span aria-hidden="true" className="one-opening-rule" />
      <button
        ref={skipRef}
        type="button"
        className="one-opening-skip"
        onClick={() => setPhase("leaving")}
      >
        {gt("Skip")}
      </button>
    </div>,
    document.body,
  );
}
