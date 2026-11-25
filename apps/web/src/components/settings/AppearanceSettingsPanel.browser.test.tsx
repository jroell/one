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
});
