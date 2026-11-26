import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * A page change as two layers: the page being left stays on screen as a still copy until the next
 * page has mounted under it, then the copy fades out. Rail, breadcrumb and body change in the one
 * commit, and nothing is restyled for the fade (a view transition restyled the document twice).
 */
let held: { readonly copy: HTMLElement; readonly timer: number } | null = null;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function remove(): void {
  if (held === null) return;
  window.clearTimeout(held.timer);
  held.copy.remove();
  held = null;
}

/** Keeps a still copy of the current page over its place; call as a page change starts. */
export function holdOutgoingSettingsPage(): void {
  remove();
  if (reducedMotion()) return;
  const page = document.querySelector<HTMLElement>("[data-settings-page-scroll]");
  if (page === null) return;
  const copy = page.cloneNode(true) as HTMLElement;
  copy.removeAttribute("data-settings-page-scroll");
  // A copy repeats ids, and it is only a picture: no focus, no reading.
  for (const element of copy.querySelectorAll("[id]")) element.removeAttribute("id");
  copy.setAttribute("data-settings-outgoing", "");
  copy.setAttribute("aria-hidden", "true");
  copy.setAttribute("inert", "");
  Object.assign(copy.style, {
    position: "absolute",
    top: `${page.offsetTop}px`,
    left: `${page.offsetLeft}px`,
    width: `${page.offsetWidth}px`,
    height: `${page.offsetHeight}px`,
    flex: "none",
    pointerEvents: "none",
  });
  page.after(copy);
  copy.scrollTop = page.scrollTop;
  // If the next page never arrives (an error, the same page), the copy does not stay forever.
  held = { copy, timer: window.setTimeout(remove, 1500) };
}

/** Fades the held copy out; call once the new page has mounted. */
export function releaseOutgoingSettingsPage(): void {
  if (held === null) return;
  const { copy, timer } = held;
  window.clearTimeout(timer);
  held = null;
  copy.setAttribute("data-settings-leaving", "");
  const done = () => copy.remove();
  copy.addEventListener("animationend", done, { once: true });
  window.setTimeout(done, 400);
}

/** Holds the outgoing page whenever the address changes while the Settings sheet is open. */
export function useHoldOutgoingSettingsPage(): void {
  const router = useRouter();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the router's navigation events for as long as the Settings sheet is open
  useEffect(
    () =>
      router.subscribe("onBeforeLoad", ({ hrefChanged }) => {
        if (hrefChanged) holdOutgoingSettingsPage();
      }),
    [router],
  );
}
