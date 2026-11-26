import { useEffect, useState } from "react";

export interface ComposerAnchor {
  /** Distance from the viewport bottom to 12px above the composer's top edge. */
  readonly bottom: number;
  /** Horizontal center of the composer. */
  readonly left: number;
  readonly width: number;
}

const ANCHOR_GAP_PX = 12;
const ANCHOR_POLL_MS = 400;

function measureComposer(): ComposerAnchor | null {
  const host = document.querySelector<HTMLElement>('[data-slot="composer-host"]');
  if (!host) return null;
  const rect = host.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    bottom: Math.round(window.innerHeight - rect.top + ANCHOR_GAP_PX),
    left: Math.round(rect.left + rect.width / 2),
    width: Math.round(rect.width),
  };
}

function sameAnchor(a: ComposerAnchor | null, b: ComposerAnchor | null): boolean {
  if (a === null || b === null) return a === b;
  return a.bottom === b.bottom && a.left === b.left && a.width === b.width;
}

/**
 * Where a toast sits so it clears the composer: just above its top edge. It measures only while
 * `active` (a toast is showing), on resize and every 400ms, since the composer grows as you type.
 * Null when no composer is on screen, and the toast falls back to the top right.
 */
export function useComposerAnchor(active: boolean): ComposerAnchor | null {
  const [anchor, setAnchor] = useState<ComposerAnchor | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures a DOM element outside React's tree while a toast is visible
  useEffect(() => {
    if (!active) return;
    const update = () =>
      setAnchor((previous) => {
        const next = measureComposer();
        return sameAnchor(previous, next) ? previous : next;
      });
    update();
    const timer = window.setInterval(update, ANCHOR_POLL_MS);
    window.addEventListener("resize", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", update);
    };
  }, [active]);

  return active ? anchor : null;
}
