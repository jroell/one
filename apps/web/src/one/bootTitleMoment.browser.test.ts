// @effect-diagnostics nodeBuiltinImport:off - reads index.html on disk.
import indexHtml from "../../index.html?raw";
import { expect, it } from "vite-plus/test";

/** Puts the boot screen's styles and markup on the page for one test and takes them off again. */
function bootScreen(): Disposable & { readonly arc: HTMLElement; readonly host: HTMLElement } {
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
    arc: host.querySelector<HTMLElement>("#boot-shell-arc")!,
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

it("shows the progress arc after the title moment while an opening is planned but not armed", () => {
  using screen = bootScreen();
  document.documentElement.dataset.oneOpening = "";
  atTime(screen.arc, 2000);
  expect(getComputedStyle(screen.arc).display).not.toBe("none");
  expect(getComputedStyle(screen.arc).opacity).toBe("1");
});

it("does not show the progress arc during the title moment, so a quick boot never shows it", () => {
  using screen = bootScreen();
  atTime(screen.arc, 900);
  expect(getComputedStyle(screen.arc).opacity).toBe("0");
});

it("hides the progress arc once the opening is armed", () => {
  using screen = bootScreen();
  document.documentElement.dataset.oneOpening = "";
  document.documentElement.dataset.oneOpeningArmed = "";
  expect(getComputedStyle(screen.arc).display).toBe("none");
});

it("turns the arc once every 1.2 seconds with a transform, not by changing layout", () => {
  using screen = bootScreen();
  const circle = screen.arc.querySelector("circle")!;
  const turned = (ms: number) => {
    atTime(circle, ms);
    const matrix = /matrix\(([^,]+), ([^,]+),/.exec(getComputedStyle(circle).transform);
    return Math.round((Math.atan2(Number(matrix?.[2]), Number(matrix?.[1])) * 180) / Math.PI);
  };
  expect(Math.abs(turned(600))).toBe(180);
  expect(Math.abs(turned(300))).toBe(90);
  const names = circle
    .getAnimations()
    .map((animation) => (animation as CSSAnimation).animationName);
  expect(names).toEqual(["boot-arc-turn"]);
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
