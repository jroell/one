import { useGT } from "gt-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { OneOrb, OPENING_SECONDS } from "./OneOrb";
import { getOpeningPreferences, onReplayOpening, OPENING_SEEN_KEY } from "./openingPreferences";
import { playOpeningSound } from "./openingSound";

/** The ring ignites, the title holds for a moment, then the app is revealed. */
const HOLD_MS = OPENING_SECONDS * 1000 + 900;
const LEAVE_MS = 700;

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
  const skipRef = useRef<HTMLButtonElement | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the opening's timers, sound and skip listeners, all outside React, while the overlay is up
  useEffect(() => {
    const app = document.getElementById("root");
    if (phase === "done") {
      delete document.documentElement.dataset.oneOpening;
      if (app) app.inert = false;
      return;
    }
    if (phase === "leaving") {
      // The app is usable again as soon as the cover starts to fade.
      if (app) app.inert = false;
      const timer = window.setTimeout(() => setPhase("done"), LEAVE_MS);
      return () => window.clearTimeout(timer);
    }
    try {
      window.sessionStorage.setItem(OPENING_SEEN_KEY, "1");
    } catch {
      // Without session storage the opening simply plays again next load.
    }
    // The cover hides the app, so the app takes no focus, keys or clicks until it lifts.
    if (app) app.inert = true;
    skipRef.current?.focus();
    const stopSound = getOpeningPreferences().sound ? playOpeningSound(OPENING_SECONDS) : () => {};
    const leave = () => {
      stopSound();
      setPhase("leaving");
    };
    const timer = window.setTimeout(leave, HOLD_MS);
    // Any key or click lifts the cover, and that key or click goes no further.
    const skip = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      leave();
    };
    window.addEventListener("keydown", skip, { once: true, capture: true });
    window.addEventListener("pointerdown", skip, { once: true, capture: true });
    return () => {
      window.clearTimeout(timer);
      stopSound();
      window.removeEventListener("keydown", skip, { capture: true });
      window.removeEventListener("pointerdown", skip, { capture: true });
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
  // Outside the app root, which is inert while the cover is up.
  return createPortal(
    <div
      className="one-opening"
      data-phase={phase}
      role="dialog"
      aria-modal="true"
      aria-label={gt("One is opening")}
    >
      <OneOrb key={play} opening className="one-opening-ring" />
      <p className="one-opening-name">One</p>
      <span aria-hidden="true" className="one-opening-rule" />
      <button ref={skipRef} type="button" className="one-opening-skip">
        {gt("Skip")}
      </button>
    </div>,
    document.body,
  );
}
