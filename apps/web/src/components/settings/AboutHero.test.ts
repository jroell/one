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

  it("shows nothing for a day that does not exist, instead of rolling it into the next month", () => {
    expect(formatBuildDay("2026-02-30", "en-US")).toBeNull();
    expect(formatBuildDay("2025-02-29", "en-US")).toBeNull();
    expect(formatBuildDay("2028-02-29", "en-US")).toBe("Feb 29, 2028");
  });
});
