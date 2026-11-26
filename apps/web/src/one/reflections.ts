import { observeResize } from "~/lib/observeResize";

/** How far outside a surface the pointer still moves its reflection, in CSS pixels. */
export const REFLECT_PROXIMITY_PX = 24;

/**
 * The longest a measured rectangle is trusted while the pointer keeps moving. A surface can move
 * without a scroll or resize (a panel opening shifts a centered composer); the next pointer move
 * after this long measures it again.
 */
export const REMEASURE_MS = 250;

const REFLECT_SELECTOR = "[data-one-reflect]";
/** A gold button's pool of light follows the pointer while it is hovered. */
const BUTTON_SELECTOR =
  '[data-button][data-variant="default"], [data-composer-send]:not([data-stage])';
/** While the agent works the edge light travels around the surface on its own and ignores the pointer. */
const WORKING_SELECTOR = "[data-one-working]";

type Tracked = {
  rect: DOMRectReadOnly | null;
  /** The `epoch` the rect was measured in. */
  measuredIn: number;
  /** When the rect was measured, in `performance.now()` milliseconds. */
  measuredAt: number;
  stopObserving: () => void;
  /** The rounded values last written, so an unchanged one is not written again. */
  x: number | null;
  y: number | null;
};

/**
 * Moves the edge reflection of the hovered `[data-one-reflect]` surface to the pointer, with one
 * passive listener for the whole app. A pointer move reads no layout: rectangles are cached until
 * a scroll or resize, or for `REMEASURE_MS` at most. A surface inside `[data-one-working]` is left alone.
 */
export function installOneReflections(): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    !window.matchMedia("(hover: hover)").matches
  ) {
    return () => {};
  }
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const tracked = new Map<HTMLElement, Tracked>();
  /** Bumped whenever a measured rectangle may have moved. */
  let epoch = 0;
  let frame = 0;
  let active: HTMLElement | null = null;
  let button: { readonly element: HTMLElement; rect: DOMRectReadOnly | null } | null = null;
  let x = 0;
  let y = 0;

  const forget = (element: HTMLElement) => {
    tracked.get(element)?.stopObserving();
    tracked.delete(element);
  };
  const track = (element: HTMLElement): Tracked => {
    const known = tracked.get(element);
    if (known) return known;
    const entry: Tracked = {
      rect: null,
      measuredIn: -1,
      measuredAt: 0,
      // Removing the element reports a size of zero: release it then, whichever way it closed.
      stopObserving: observeResize(element, () => {
        epoch++;
        if (!element.isConnected) forget(element);
      }),
      x: null,
      y: null,
    };
    tracked.set(element, entry);
    return entry;
  };
  const rectOf = (element: HTMLElement, entry: Tracked): DOMRectReadOnly => {
    const now = performance.now();
    if (
      entry.rect === null ||
      entry.measuredIn !== epoch ||
      now - entry.measuredAt >= REMEASURE_MS
    ) {
      entry.rect = element.getBoundingClientRect();
      entry.measuredIn = epoch;
      entry.measuredAt = now;
    }
    return entry.rect;
  };

  /** The surface under the pointer, or one the pointer is close to, or null. */
  const surfaceAt = (target: EventTarget | null): HTMLElement | null => {
    const over = target instanceof Element ? target.closest<HTMLElement>(REFLECT_SELECTOR) : null;
    if (over) {
      if (over.closest(WORKING_SELECTOR)) return null;
      const entry = track(over);
      // Layout can move a surface without a scroll or resize; measure again on each entry.
      if (over !== active) entry.measuredIn = -1;
      return over;
    }
    for (const [element, entry] of tracked) {
      if (!element.isConnected) {
        forget(element);
        continue;
      }
      if (element.closest(WORKING_SELECTOR)) continue;
      const rect = rectOf(element, entry);
      if (
        x >= rect.left - REFLECT_PROXIMITY_PX &&
        x <= rect.right + REFLECT_PROXIMITY_PX &&
        y >= rect.top - REFLECT_PROXIMITY_PX &&
        y <= rect.bottom + REFLECT_PROXIMITY_PX
      ) {
        return element;
      }
    }
    return null;
  };

  const write = (element: HTMLElement) => {
    const entry = tracked.get(element);
    if (!entry || !element.isConnected) {
      forget(element);
      return false;
    }
    if (element.closest(WORKING_SELECTOR)) return true;
    const rect = rectOf(element, entry);
    const nextX = Math.round(x - rect.left);
    const nextY = Math.round(y - rect.top);
    if (nextX !== entry.x) {
      element.style.setProperty("--one-mx", `${nextX}px`);
      entry.x = nextX;
    }
    if (nextY !== entry.y) {
      element.style.setProperty("--one-my", `${nextY}px`);
      entry.y = nextY;
    }
    return true;
  };

  const writeButton = () => {
    if (!button) return;
    if (!button.element.isConnected) {
      button = null;
      return;
    }
    button.rect ??= button.element.getBoundingClientRect();
    button.element.style.setProperty("--one-mx", `${Math.round(x - button.rect.left)}px`);
    button.element.style.setProperty("--one-my", `${Math.round(y - button.rect.top)}px`);
  };

  const apply = () => {
    frame = 0;
    if (active && !write(active)) active = null;
    writeButton();
  };

  const sweepDetached = () => {
    for (const element of tracked.keys()) {
      if (!element.isConnected) forget(element);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch" || reducedMotion.matches) return;
    x = event.clientX;
    y = event.clientY;
    active = surfaceAt(event.target);
    const over =
      event.target instanceof Element ? event.target.closest<HTMLElement>(BUTTON_SELECTOR) : null;
    if (over?.hasAttribute("disabled")) {
      button = null;
    } else if (over !== (button?.element ?? null)) {
      button = over ? { element: over, rect: null } : null;
    }
    if ((active || button) && frame === 0) frame = requestAnimationFrame(apply);
  };
  const onLayoutChange = () => {
    epoch++;
    if (button) button.rect = null;
  };

  document.addEventListener("pointermove", onPointerMove, { passive: true });
  // A surface closed from the keyboard leaves no pointer event behind to release it.
  document.addEventListener("keydown", sweepDetached, { passive: true });
  // Scroll does not bubble; a capturing listener hears every scroll container.
  window.addEventListener("scroll", onLayoutChange, { capture: true, passive: true });
  window.addEventListener("resize", onLayoutChange, { passive: true });
  return () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("keydown", sweepDetached);
    window.removeEventListener("scroll", onLayoutChange, { capture: true });
    window.removeEventListener("resize", onLayoutChange);
    if (frame !== 0) cancelAnimationFrame(frame);
    for (const entry of tracked.values()) entry.stopObserving();
    tracked.clear();
  };
}
