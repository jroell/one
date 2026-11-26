import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";

const { updateSettings } = vi.hoisted(() => ({ updateSettings: vi.fn() }));

vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => DEFAULT_UNIFIED_SETTINGS) as never,
  useScopedSettingsMixed: () => false,
  useUpdateScopedSettings: () => updateSettings,
}));

import { ChatSettingsPanel } from "./SettingsPanels";

describe("Chat settings saved links", () => {
  it.each([
    ["follow-ups", "follow-up-behavior"],
    ["side-threads", "side-thread-open-target"],
    ["activity", "tool-call-visibility"],
  ])("opens the row for the old #%s fragment", async (fragment, rowId) => {
    await using _screen = await render(<ChatSettingsPanel />, {
      router: `/settings/chat#${fragment}`,
    });

    await expect.poll(() => document.activeElement?.id).toBe(rowId);
  });
});

describe("Chat settings reading face", () => {
  it("starts on the serif and saves the sans when it is chosen", async () => {
    updateSettings.mockClear();
    await using screen = await render(<ChatSettingsPanel />, { router: "/settings/chat" });
    const trigger = screen.getByRole("combobox", { name: "Reading face" });
    await expect.element(trigger).toHaveTextContent("Serif");

    await trigger.click();
    await screen.getByRole("option", { name: "Sans-serif" }).click();
    expect(updateSettings).toHaveBeenCalledWith({ chatReadingFace: "sans" });
  });
});
