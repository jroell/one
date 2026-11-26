import { describe, expect, it } from "vite-plus/test";

import { pickComposerHost, placeAboveComposer, placeInMainColumn } from "./useComposerAnchor";

function host(options: { top: number; editable?: boolean; hidden?: boolean }) {
  const element = document.createElement("div");
  element.dataset.slot = "composer-host";
  element.style.cssText = `position:fixed;left:100px;top:${options.top}px;width:400px;height:60px`;
  if (options.editable) {
    const input = document.createElement("textarea");
    element.append(input);
  }
  if (options.hidden) element.setAttribute("aria-hidden", "true");
  document.body.append(element);
  return element;
}

describe("the composer a toast sits above", () => {
  it("prefers the composer that holds focus, then an editable one, the lowest first, and skips hidden ones", () => {
    const readOnly = host({ top: 700 });
    const main = host({ top: 600, editable: true });
    const side = host({ top: 400, editable: true });
    const hidden = host({ top: 800, editable: true, hidden: true });
    try {
      expect(pickComposerHost([readOnly, main, side, hidden], null)).toBe(main);
      side.querySelector("textarea")!.focus();
      expect(pickComposerHost([readOnly, main, side, hidden], document.activeElement)).toBe(side);
      expect(pickComposerHost([readOnly, hidden], null)).toBe(readOnly);
    } finally {
      for (const element of [readOnly, main, side, hidden]) element.remove();
    }
  });
});

describe("placing a toast above a composer", () => {
  const rect = (top: number) => ({ top, left: 100, width: 400 });

  it("sits 12px above the composer's top edge and centered on it", () => {
    expect(placeAboveComposer(rect(700), 70, 900)).toEqual({ bottom: 212, left: 300, width: 400 });
  });

  it("keeps the toast inside the viewport when the composer is near the top, and gives up when there is no room", () => {
    // 90px of room above the composer: a 70px toast needs 70 + 12 + 8.
    expect(placeAboveComposer(rect(90), 70, 900)).toEqual({ bottom: 810, left: 300, width: 400 });
    expect(placeAboveComposer(rect(89), 70, 900)).toBeNull();
  });

  it("sits at the bottom of the main column, centered on it, when there is no composer to sit above", () => {
    expect(placeInMainColumn({ left: 256, width: 1000 })).toEqual({
      bottom: 24,
      left: 756,
      width: 1000,
    });
  });
});
