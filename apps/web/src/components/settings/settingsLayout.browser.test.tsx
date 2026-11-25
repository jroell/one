import { render } from "../../../test/render";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "../../index.css";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

function selectRow(title: string, value: string) {
  return (
    <SettingsRow
      title={title}
      description="A description that is long enough to be read as a sentence."
      control={
        <Select value={value}>
          <SelectTrigger size="sm" aria-label={title}>
            <SelectValue>{value}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={value}>{value}</SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}

function wideContainer() {
  const container = document.createElement("div");
  container.style.width = "880px";
  return container;
}

describe("settings layout", () => {
  it("draws select controls at one width and one right edge down a section", async () => {
    await using screen = await render(
      <SettingsSection title="Behavior">
        {selectRow("Short", "On")}
        {selectRow("Medium length", "Last user message")}
        {selectRow("Long", "Repository conventions and more")}
      </SettingsSection>,
      { container: wideContainer(), router: false },
    );

    const rects = ["Short", "Medium length", "Long"].map((name) =>
      page.getByRole("combobox", { name }).element().getBoundingClientRect(),
    );
    expect(new Set(rects.map((rect) => Math.round(rect.width))).size).toBe(1);
    expect(new Set(rects.map((rect) => Math.round(rect.right))).size).toBe(1);
    expect(screen.container.querySelectorAll("[data-settings-control]")).toHaveLength(3);
  });

  it("sorts a danger row after the primary action of its section whatever the source order", async () => {
    await using _screen = await render(
      <SettingsSection title="Cleanup">
        <SettingsRow
          danger
          title="Delete everything"
          control={<Button variant="destructive-outline">Delete everything</Button>}
        />
        <SettingsRow title="Create link" control={<Button>Create link</Button>} />
      </SettingsSection>,
      { container: wideContainer(), router: false },
    );

    const primary = page.getByRole("button", { name: "Create link" }).element();
    const destructive = page.getByRole("button", { name: "Delete everything" }).element();
    expect(destructive.getBoundingClientRect().top).toBeGreaterThan(
      primary.getBoundingClientRect().bottom,
    );
  });

  it("renders one level-one title and the purpose line at the top of a settings page", async () => {
    await using _screen = await render(
      <SettingsPageContainer>
        <SettingsSection title="Composer">
          <SettingsRow title="Rich text composer" />
        </SettingsSection>
      </SettingsPageContainer>,
      { router: "/settings/chat" },
    );

    await expect.element(page.getByRole("heading", { level: 1, name: "Chat" })).toBeVisible();
    await expect
      .element(page.getByText("How the composer, follow-ups and tool calls behave."))
      .toBeVisible();
  });
});
