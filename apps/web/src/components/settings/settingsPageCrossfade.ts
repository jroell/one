import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * A page change keeps the page being left on screen as a still copy until the next page has
 * mounted. The copy goes in that same frame, so heading and breadcrumb always name one page.
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

/** Removes the held copy and fades the new page up; call once the new page has mounted. */
export function releaseOutgoingSettingsPage(): void {
  if (held === null) return;
  remove();
  const page = document.querySelector<HTMLElement>("[data-settings-page-scroll]");
  if (page === null) return;
  page.setAttribute("data-settings-arriving", "");
  page.addEventListener("animationend", () => page.removeAttribute("data-settings-arriving"), {
    once: true,
  });
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
