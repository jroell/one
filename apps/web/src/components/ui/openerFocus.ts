import { useRef } from "react";

const RECENT = 4;
const FOCUSABLE =
  'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role="button"]';

// What the person last focused or pressed, newest last. A dialog that focuses its own field as it
// mounts (React `autoFocus`) has already moved focus by the time the dialog library looks for the
// element to return to, so the opener is read from here instead.
const recent: Opener[] = [];

function note(target: EventTarget | null) {
  if (!(target instanceof Element)) return;
  const element = target.closest(FOCUSABLE) ?? target;
  recent.push({ element, around: around(element) });
  if (recent.length > RECENT) recent.shift();
}

if (typeof window !== "undefined") {
  window.addEventListener("focusin", (event) => note(event.target), true);
  window.addEventListener("pointerdown", (event) => note(event.target), true);
}

interface Opener {
  readonly element: Element;
  /** Focusable elements around the opener, nearest first, for when the opener is gone. */
  readonly around: ReadonlyArray<Element>;
}

function around(element: Element): Element[] {
  const found: Element[] = [];
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node.matches(FOCUSABLE)) found.push(node);
  }
  return found;
}

/**
 * Focus returns to the element that opened a dialog, sheet or alert dialog, whatever the dialog
 * focused as it mounted. If the opener has unmounted, to the nearest focusable element around
 * where it was, and failing that to the library's own choice. `remember` runs when the popup opens.
 */
export function useOpenerFocusReturn() {
  const opener = useRef<Opener | null>(null);
  const remember = (popup: Element | null) => {
    // The opener may already be gone (it removed itself as it was pressed), so its surroundings,
    // read when it was last focused, count too.
    opener.current =
      [...recent]
        .reverse()
        .find(
          (candidate) =>
            !popup?.contains(candidate.element) &&
            (candidate.element.isConnected || candidate.around.some((near) => near.isConnected)),
        ) ?? null;
  };
  const finalFocus = (): HTMLElement | boolean => {
    const known = opener.current;
    if (!known) return true;
    if (known.element.isConnected && known.element instanceof HTMLElement) return known.element;
    const next = known.around.find((candidate) => candidate.isConnected);
    return next instanceof HTMLElement ? next : true;
  };
  return { remember, finalFocus };
}
