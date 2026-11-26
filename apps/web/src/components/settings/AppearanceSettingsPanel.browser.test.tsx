import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => DEFAULT_UNIFIED_SETTINGS) as never,
  useScopedSettingsMixed: () => false,
  useUpdateScopedSettings: () => vi.fn(),
}));

import { AppearanceSettingsPanel } from "./AppearanceSettingsPanel";

describe("appearance sliders", () => {
  it("puts the contrast thumb under its 100% label, at the middle of its labelled track", async () => {
    await using screen = await render(
      <div data-app-modal="" className="w-[880px]">
        <AppearanceSettingsPanel />
      </div>,
    );
    const input = screen.container.querySelector<HTMLInputElement>("#appearance-contrast")!;
    const track = input.closest(".settings-slider-track")!;
    const labels = [...track.querySelectorAll(".settings-slider-range > span")];
    expect(labels.map((label) => label.textContent)).toEqual(["50%", "100%", "200%"]);
    const box = input.getBoundingClientRect();
    const thumb = 16; // the 1rem thumb stays inside the track, so its centre travels 8px in from each end
    const value = Number(input.value) / 100;
    const thumbCentre = box.left + thumb / 2 + value * (box.width - thumb);
    const mid = labels[1]!.getBoundingClientRect();
    expect(Math.abs(thumbCentre - (mid.left + mid.width / 2))).toBeLessThan(2);
  });

  it("marks the chosen color scheme and theme with a ring and a check, and draws themes as the app", async () => {
    await using screen = await render(
      <div data-app-modal="" className="w-[880px]">
        <AppearanceSettingsPanel />
      </div>,
    );
    const chosen = screen.container.querySelector<HTMLElement>(
      '[data-settings-card][aria-pressed="true"]',
    )!;
    const other = screen.container.querySelector<HTMLElement>(
      '[data-settings-card][aria-pressed="false"]',
    )!;
    expect(getComputedStyle(chosen).boxShadow).toContain("1.5px");
    expect(getComputedStyle(other).boxShadow).not.toContain("1.5px");
    expect(getComputedStyle(chosen, "::after").content).toBe('""');
    expect(getComputedStyle(other, "::after").content).not.toBe('""');

    const theme = screen.container.querySelector<HTMLElement>(
      '[data-theme-library-card="default"]',
    )!;
    expect(getComputedStyle(theme).boxShadow).toContain("1.5px");
    // A theme is a small app window (sidebar, message, composer), not a blurred gradient disc.
    expect(theme.querySelector('[style*="blur"]')).toBeNull();
    const preview = theme.querySelector<HTMLElement>("span[aria-hidden].rounded-lg")!;
    expect(preview.getBoundingClientRect().width).toBeGreaterThan(
      preview.getBoundingClientRect().height,
    );
  });
});
