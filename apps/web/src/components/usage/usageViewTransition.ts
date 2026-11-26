import { flushSync } from "react-dom";

type StartViewTransition = (update: () => void) => { readonly finished: Promise<unknown> };

/**
 * Runs a view change as a cross-fade of the page body where the browser can: the old view fades
 * out as the new one fades in and rises a few pixels, so switching tabs never shows an empty page.
 * Without view transitions, or under reduced motion, the change simply happens.
 */
export function transitionView(update: () => void): void {
  const start = (document as Document & { startViewTransition?: StartViewTransition })
    .startViewTransition;
  if (typeof start !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset["usageSwitch"] = "";
  const transition = start.call(document, () => flushSync(update));
  void transition.finished.finally(() => {
    delete root.dataset["usageSwitch"];
  });
}
