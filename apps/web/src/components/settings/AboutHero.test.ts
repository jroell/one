import { describe, expect, it } from "vite-plus/test";

import { formatBuildDay } from "./AboutHero";

describe("formatBuildDay", () => {
  it("shows a stored build day in the reader's date style without shifting it across time zones", () => {
    expect(formatBuildDay("2026-11-25", "en-US")).toBe("Nov 25, 2026");
    expect(formatBuildDay("2026-01-01", "de-DE")).toBe("01.01.2026");
  });

  it("shows nothing when the build recorded no day or a malformed one", () => {
    expect(formatBuildDay(null, "en-US")).toBeNull();
    expect(formatBuildDay("", "en-US")).toBeNull();
    expect(formatBuildDay("yesterday", "en-US")).toBeNull();
    expect(formatBuildDay("2026-13-45", "en-US")).toBeNull();
  });
});
