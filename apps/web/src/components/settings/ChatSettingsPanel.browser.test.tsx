import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import {
  ensureClientSettingsHydrated,
  getClientSettings,
  updateClientSettings,
} from "~/hooks/useSettings";
import { readBrowserClientSettings } from "~/clientPersistenceStorage";
import { ChatSettingsPanel } from "./SettingsPanels";
import { SettingsScopeProvider } from "./SettingsScopeContext";

function ScopedChatSettings() {
  return (
    <SettingsScopeProvider search={{}} onChange={() => {}} deviceOnly>
      <ChatSettingsPanel />
    </SettingsScopeProvider>
  );
}

describe("Chat settings saved links", () => {
  it.each([
    ["follow-ups", "follow-up-behavior"],
    ["side-threads", "side-thread-open-target"],
    ["activity", "tool-call-visibility"],
  ])("opens the row for the old #%s fragment", async (fragment, rowId) => {
    await using _screen = await render(<ScopedChatSettings />, {
      router: `/settings/chat#${fragment}`,
    });

    await expect.poll(() => document.activeElement?.id).toBe(rowId);
  });
});

describe("Chat settings reading font", () => {
  it("names the Writing section and saves the selected chat reading font", async () => {
    await ensureClientSettingsHydrated();
    const previous = getClientSettings().chatReadingFace;
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() => updateClientSettings({ chatReadingFace: previous }));
    await updateClientSettings({ chatReadingFace: "serif" });
    await using screen = await render(<ScopedChatSettings />, { router: "/settings/chat" });
    await expect.element(screen.getByText("Writing", { exact: true })).toBeVisible();
    await expect
      .element(
        screen.getByText(
          "The font answers use in Chat mode. Code answers always use the interface font.",
        ),
      )
      .toBeVisible();
    const trigger = screen.getByRole("combobox", { name: "Chat reading font" });
    await expect.element(trigger).toHaveTextContent("Serif");

    await trigger.click();
    await page.getByRole("option", { name: "Sans-serif" }).click();
    await expect.element(trigger).toHaveTextContent("Sans-serif");
    await expect.poll(() => readBrowserClientSettings()?.chatReadingFace).toBe("sans");
  });
});
