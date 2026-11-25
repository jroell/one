import { describe, expect, it } from "vite-plus/test";

import { contrastToPosition, positionToContrast, stepContrast } from "./contrastSlider.logic";

describe("contrast slider", () => {
  it("puts the neutral 100% in the middle of the track and the ends at the ends", () => {
    expect(contrastToPosition(50)).toBe(0);
    expect(contrastToPosition(100)).toBe(50);
    expect(contrastToPosition(200)).toBe(100);
    expect(contrastToPosition(75)).toBe(25);
    expect(contrastToPosition(150)).toBe(75);
  });

  it("reads every stored contrast back to itself", () => {
    for (let contrast = 50; contrast <= 200; contrast += 5) {
      expect(positionToContrast(contrastToPosition(contrast))).toBe(contrast);
    }
  });

  it("moves a keyboard step the same five points either side of 100% and stops at the ends", () => {
    expect(stepContrast(100, "ArrowRight")).toBe(105);
    expect(stepContrast(100, "ArrowLeft")).toBe(95);
    expect(stepContrast(200, "ArrowUp")).toBe(200);
    expect(stepContrast(50, "ArrowDown")).toBe(50);
    expect(stepContrast(120, "Home")).toBe(50);
    expect(stepContrast(120, "Tab")).toBeNull();
  });
});
