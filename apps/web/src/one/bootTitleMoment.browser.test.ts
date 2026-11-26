// @effect-diagnostics nodeBuiltinImport:off - reads index.html on disk.
import indexHtml from "../../index.html?raw";
import { expect, it } from "vite-plus/test";

/** Puts the boot screen's styles and markup on the page for one test and takes them off again. */
function bootScreen(): Disposable & { readonly host: HTMLElement } {
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
    host,
    [Symbol.dispose]: () => {
      host.remove();
      for (const style of styles) style.remove();
      delete document.documentElement.dataset.oneOpening;
      delete document.documentElement.dataset.oneOpeningArmed;
    },
  };
}

/** Jumps every animation on `element` and what it holds to `ms` after the page started waiting. */
function atTime(element: Element, ms: number) {
  for (const animation of document.getAnimations()) {
    const target =
      animation.effect && "target" in animation.effect ? animation.effect.target : null;
    if (target && element.contains(target as Node)) animation.currentTime = ms;
  }
}

it("draws no orbit arc around the ring: the ring itself carries the wait", () => {
  using screen = bootScreen();
  expect(screen.host.querySelector("svg#boot-shell-arc, #boot-shell-arc")).toBeNull();
});

it("turns the ring about its vertical axis once every 8 seconds, after it has settled, without moving layout", () => {
  using screen = bootScreen();
  const ring = screen.host.querySelector<HTMLElement>("#boot-shell-ring")!;
  const turned = (ms: number) => {
    atTime(ring, ms);
    const degrees = /(-?\d+(?:\.\d+)?)deg/.exec(getComputedStyle(ring).rotate)?.[1];
    return Math.round(Number(degrees ?? 0));
  };
  expect(turned(600)).toBe(0);
  expect(turned(900 + 2000)).toBe(90);
  expect(turned(900 + 4000)).toBe(180);
  const animated = ring
    .getAnimations()
    .map((animation) => (animation as CSSAnimation).animationName);
  expect(animated).toContain("boot-ring-turn");
});

it("plays the title moment: the ring settles, the sweep crosses and clears, the name arrives after it", () => {
  using screen = bootScreen();
  const opacityAt = (selector: string, ms: number) => {
    const element = screen.host.querySelector(selector)!;
    atTime(element, ms);
    return Number(getComputedStyle(element).opacity);
  };
  expect(opacityAt("#boot-shell-ring", 0)).toBe(0);
  expect(opacityAt("#boot-shell-ring", 1200)).toBe(1);
  expect(opacityAt("#boot-shell-name", 200)).toBe(0);
  expect(opacityAt("#boot-shell-name", 1200)).toBe(1);
  expect(opacityAt("#boot-shell-sweep", 420 + 350)).toBeGreaterThan(0.9);
  expect(opacityAt("#boot-shell-sweep", 1400)).toBe(0);
});
