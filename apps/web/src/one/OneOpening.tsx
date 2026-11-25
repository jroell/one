import { useGT } from "gt-react";
import { useEffect, useState } from "react";

import { OneOrb, OPENING_SECONDS } from "./OneOrb";
import { playOpeningSound } from "./openingSound";

const OPENING_SEEN_KEY = "one:opening-seen";
const OPENING_PREFERENCE_KEY = "one:opening";
const OPENING_SOUND_PREFERENCE_KEY = "one:opening-sound";
/** The ring ignites, the title holds for a moment, then the app is revealed. */
const HOLD_MS = OPENING_SECONDS * 1000 + 900;
const LEAVE_MS = 700;

function readFlag(storage: "sessionStorage" | "localStorage", key: string): string | null {
  try {
    return window[storage].getItem(key);
  } catch {
    return null;
  }
}

/** Once per app session, and never for people who turned it off or prefer reduced motion. */
function shouldPlayOpening(): boolean {
  if (typeof window === "undefined") return false;
  if (readFlag("localStorage", OPENING_PREFERENCE_KEY) === "off") return false;
  if (readFlag("sessionStorage", OPENING_SEEN_KEY) !== null) return false;
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the opening's timers, sound and skip listeners, all outside React, while the overlay is up
  useEffect(() => {
    if (phase === "done") {
      delete document.documentElement.dataset.oneOpening;
      return;
    }
    if (phase === "leaving") {
      const timer = window.setTimeout(() => setPhase("done"), LEAVE_MS);
      return () => window.clearTimeout(timer);
    }
    try {
      window.sessionStorage.setItem(OPENING_SEEN_KEY, "1");
    } catch {
      // Without session storage the opening simply plays again next load.
    }
    const stopSound =
      readFlag("localStorage", OPENING_SOUND_PREFERENCE_KEY) === "off"
        ? () => {}
        : playOpeningSound(OPENING_SECONDS);
    const leave = () => setPhase("leaving");
    const timer = window.setTimeout(leave, HOLD_MS);
    const skip = () => {
      stopSound();
      leave();
    };
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("pointerdown", skip, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [phase]);

  if (phase === "done") return null;
  return (
    <div className="one-opening" data-phase={phase} role="img" aria-label={gt("One is opening")}>
      <OneOrb opening className="one-opening-ring" />
      {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product name */}
      <p className="one-opening-name">One</p>
      <span aria-hidden="true" className="one-opening-rule" />
    </div>
  );
}
