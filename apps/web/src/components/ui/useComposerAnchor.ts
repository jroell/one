import { useEffect, useRef, useState } from "react";

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
const WINDOW_MARGIN_PX = 24;
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

/** With no composer on the page the toast keeps the same place: the bottom of the main column. */
export function placeInMainColumn(rect: Pick<DOMRect, "left" | "width">): ComposerAnchor {
  return {
    bottom: WINDOW_MARGIN_PX,
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
  const above = host
    ? placeAboveComposer(
        host.getBoundingClientRect(),
        toastHeight > 0 ? toastHeight : ESTIMATED_TOAST_HEIGHT_PX,
        window.innerHeight,
      )
    : null;
  if (above) return { anchor: above, host };
  const column = document.querySelector<HTMLElement>('[data-slot="sidebar-inset"]');
  return { anchor: column ? placeInMainColumn(column.getBoundingClientRect()) : null, host };
}

function sameAnchor(a: ComposerAnchor | null, b: ComposerAnchor | null): boolean {
  if (a === null || b === null) return a === b;
  return a.bottom === b.bottom && a.left === b.left && a.width === b.width;
}

/**
 * Where a toast sits: above the composer, or at the bottom of the main column when there is no
 * room or no composer. The same place on every page. It measures only while
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

const TIMELINE = ".messages-timeline-scroll";
const LANE_RELEASE_MS = 320;

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
}

function atEnd(scroller: HTMLElement): boolean {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4;
}

interface ScrollerLane {
  /** The padding the scroller had before any toast claimed it. */
  readonly original: string;
  claims: number;
  releaseTimer: number | undefined;
}

const lanes = new WeakMap<HTMLElement, ScrollerLane>();

function claimLane(scroller: HTMLElement): { lane: ScrollerLane; resumed: boolean } {
  const lane = lanes.get(scroller) ?? {
    original: scroller.style.paddingBottom,
    claims: 0,
    releaseTimer: undefined,
  };
  // A toast that arrives while the last one is leaving takes over its padding; the reader was at
  // the end of the thread when it left, so they are taken back to the end.
  const resumed = lane.releaseTimer !== undefined;
  window.clearTimeout(lane.releaseTimer);
  lane.releaseTimer = undefined;
  lane.claims += 1;
  lanes.set(scroller, lane);
  return { lane, resumed };
}

function releaseLane(scroller: HTMLElement, lane: ScrollerLane, reserved: number) {
  lane.claims -= 1;
  if (lane.claims > 0) return;
  const restore = () => {
    scroller.style.paddingBottom = lane.original;
    lanes.delete(scroller);
  };
  if (!scroller.isConnected || !atEnd(scroller)) {
    restore();
    return;
  }
  scroller.scrollTo({
    top: Math.max(0, scroller.scrollHeight - scroller.clientHeight - reserved),
    behavior: scrollBehavior(),
  });
  lane.releaseTimer = window.setTimeout(restore, LANE_RELEASE_MS);
}

/**
 * Keeps the thread's last lines out from under a toast: the timeline gets bottom padding the
 * toast's height and, at the end of a thread, scrolls that far; a reader mid-thread keeps their
 * place. The first toast's original padding is kept per scroller, so no gap is left behind.
 */
export function useToastLane(active: boolean, toastHeight: number): void {
  const lane =
    (toastHeight > 0 ? toastHeight : ESTIMATED_TOAST_HEIGHT_PX) +
    ANCHOR_GAP_PX +
    VIEWPORT_MARGIN_PX;
  const laneRef = useRef(lane);
  const scrollerRef = useRef<HTMLElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest lane for the cleanup below, which runs outside render
  useEffect(() => {
    laneRef.current = lane;
  }, [lane]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reserves bottom padding on the timeline scroller, a DOM node outside React's tree, while a toast shows
  useEffect(() => {
    if (!active) return;
    const scroller = document.querySelector<HTMLElement>(TIMELINE);
    if (!scroller) return;
    scrollerRef.current = scroller;
    const { lane: claim, resumed } = claimLane(scroller);
    const follow = resumed || atEnd(scroller);
    scroller.style.paddingBottom = `${laneRef.current}px`;
    if (follow) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: scrollBehavior() });
    }
    return () => {
      scrollerRef.current = null;
      releaseLane(scroller, claim, laneRef.current);
    };
  }, [active]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resizes the reserved padding on the timeline scroller when the measured toast height replaces the estimate
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!active || !scroller || scroller.style.paddingBottom === `${lane}px`) return;
    const follow = atEnd(scroller);
    scroller.style.paddingBottom = `${lane}px`;
    if (follow) scroller.scrollTo({ top: scroller.scrollHeight, behavior: scrollBehavior() });
  }, [active, lane]);
}
