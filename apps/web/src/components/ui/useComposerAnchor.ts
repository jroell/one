import { useEffect, useState } from "react";

import { observeResize } from "~/lib/observeResize";

export interface ComposerAnchor {
  /** Distance from the viewport bottom to 12px above the composer's top edge. */
  readonly bottom: number;
  /** Horizontal center of the composer. */
  readonly left: number;
  readonly width: number;
}

const ANCHOR_GAP_PX = 12;
const VIEWPORT_MARGIN_PX = 8;
const ANCHOR_POLL_MS = 400;
/** Used until Base UI has measured the toast. */
const ESTIMATED_TOAST_HEIGHT_PX = 72;
const EDITABLE = 'textarea, input, [contenteditable="true"], [role="textbox"]';

function isVisible(host: HTMLElement): boolean {
  if (host.closest('[inert], [aria-hidden="true"]')) return false;
  const rect = host.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
}

/**
 * The composer a toast sits above. A window can hold several (the thread, a side chat, a linked
 * read-only pane): the one with focus wins, then an editable one, the lowest on screen first.
 */
export function pickComposerHost(
  hosts: readonly HTMLElement[],
  active: Element | null,
): HTMLElement | null {
  const visible = hosts.filter(isVisible);
  const focused = visible.find((host) => active !== null && host.contains(active));
  if (focused) return focused;
  const lowest = (list: HTMLElement[]) =>
    list.reduce<HTMLElement | null>(
      (best, host) =>
        !best || host.getBoundingClientRect().bottom > best.getBoundingClientRect().bottom
          ? host
          : best,
      null,
    );
  return lowest(visible.filter((host) => host.querySelector(EDITABLE) !== null)) ?? lowest(visible);
}

/**
 * Where a toast of `toastHeight` sits so it clears the composer: 12px above its top edge, kept
 * inside the viewport. Null when there is no room above the composer.
 */
export function placeAboveComposer(
  rect: Pick<DOMRect, "top" | "left" | "width">,
  toastHeight: number,
  viewportHeight: number,
): ComposerAnchor | null {
  const needed = toastHeight + ANCHOR_GAP_PX + VIEWPORT_MARGIN_PX;
  if (rect.top < needed) return null;
  return {
    bottom: Math.round(
      Math.min(viewportHeight - rect.top + ANCHOR_GAP_PX, viewportHeight - needed),
    ),
    left: Math.round(rect.left + rect.width / 2),
    width: Math.round(rect.width),
  };
}

function measureComposer(toastHeight: number): {
  anchor: ComposerAnchor | null;
  host: HTMLElement | null;
} {
  const hosts = [...document.querySelectorAll<HTMLElement>('[data-slot="composer-host"]')];
  const host = pickComposerHost(hosts, document.activeElement);
  if (!host) return { anchor: null, host: null };
  return {
    anchor: placeAboveComposer(
      host.getBoundingClientRect(),
      toastHeight > 0 ? toastHeight : ESTIMATED_TOAST_HEIGHT_PX,
      window.innerHeight,
    ),
    host,
  };
}

function sameAnchor(a: ComposerAnchor | null, b: ComposerAnchor | null): boolean {
  if (a === null || b === null) return a === b;
  return a.bottom === b.bottom && a.left === b.left && a.width === b.width;
}

/**
 * Where a toast sits so it clears the composer, or null for the top right. It measures only while
 * `active` (a toast is showing): on resize, scroll and every 400ms, and at once when the composer
 * changes size, since it grows as you type.
 */
export function useComposerAnchor(active: boolean, toastHeight: number): ComposerAnchor | null {
  const [anchor, setAnchor] = useState<ComposerAnchor | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures a DOM element outside React's tree while a toast is visible
  useEffect(() => {
    if (!active) return;
    let stopObserving = () => {};
    let observed: HTMLElement | null = null;
    const update = () => {
      const next = measureComposer(toastHeight);
      if (next.host !== observed) {
        stopObserving();
        observed = next.host;
        stopObserving = next.host ? observeResize(next.host, update) : () => {};
      }
      setAnchor((previous) => (sameAnchor(previous, next.anchor) ? previous : next.anchor));
    };
    update();
    const timer = window.setInterval(update, ANCHOR_POLL_MS);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { capture: true, passive: true });
    return () => {
      stopObserving();
      window.clearInterval(timer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, { capture: true });
    };
  }, [active, toastHeight]);

  return active ? anchor : null;
}
