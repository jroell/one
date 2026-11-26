// @effect-diagnostics nodeBuiltinImport:off - reads index.html on disk.
import indexHtml from "../../index.html?raw";
import { expect, it } from "vite-plus/test";

/** Puts the boot screen's styles and markup on the page for one test and takes them off again. */
function bootScreen(): Disposable & { readonly bar: HTMLElement } {
  const parsed = new DOMParser().parseFromString(indexHtml, "text/html");
  const styles = [...parsed.querySelectorAll("style")].map((source) => {
    const style = document.createElement("style");
    style.textContent = source.textContent;
    document.head.append(style);
    return style;
  });
  const host = document.createElement("div");
  host.innerHTML = parsed.querySelector("#boot-shell")!.outerHTML;
  document.body.append(host);
  return {
    bar: host.querySelector<HTMLElement>("#boot-shell-bar")!,
    [Symbol.dispose]: () => {
      host.remove();
      for (const style of styles) style.remove();
      delete document.documentElement.dataset.oneOpening;
      delete document.documentElement.dataset.oneOpeningArmed;
    },
  };
}

/** Jumps every animation on the bar and its fill to `ms` after the page started waiting. */
function atTime(bar: HTMLElement, ms: number) {
  for (const animation of document.getAnimations()) {
    const target =
      animation.effect && "target" in animation.effect ? animation.effect.target : null;
    if (target === bar) animation.currentTime = ms;
  }
}

it("shows the progress hairline after the delay while an opening is planned but not armed", () => {
  using screen = bootScreen();
  document.documentElement.dataset.oneOpening = "";
  atTime(screen.bar, 2000);
  expect(getComputedStyle(screen.bar).display).not.toBe("none");
  expect(getComputedStyle(screen.bar).opacity).toBe("1");
});

it("hides the progress hairline once the opening is armed", () => {
  using screen = bootScreen();
  document.documentElement.dataset.oneOpening = "";
  document.documentElement.dataset.oneOpeningArmed = "";
  expect(getComputedStyle(screen.bar).display).toBe("none");
});

it("fills the hairline from its left edge, growing as the wait goes on", () => {
  using screen = bootScreen();
  const fill = (ms: number) => {
    for (const animation of document.getAnimations()) {
      const effect = animation.effect as KeyframeEffect | null;
      if (effect?.target === screen.bar && effect.pseudoElement === "::before") {
        animation.currentTime = ms;
      }
    }
    const transform = getComputedStyle(screen.bar, "::before").transform;
    return Number(/matrix\(([^,]+),/.exec(transform)?.[1] ?? Number.NaN);
  };
  const early = fill(1600);
  const late = fill(6000);
  expect(early).toBeGreaterThan(0);
  expect(late).toBeGreaterThan(early);
  expect(late).toBeLessThan(1);
  expect(getComputedStyle(screen.bar, "::before").transformOrigin.startsWith("0px")).toBe(true);
});
