import { textContrast } from "../../../test/contrast";
import { render } from "../../../test/render";
import type { ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "../../index.css";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsEmptyState } from "./SettingsEmptyState";
import {
  SettingsPageContainer,
  SettingsPickerField,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

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

function inputRow(title: string) {
  return (
    <SettingsRow
      title={title}
      control={
        <div className="flex w-full min-w-0 items-center justify-end gap-2 @min-[32rem]/settings-row:w-auto">
          <Input
            nativeInput
            size="sm"
            aria-label={title}
            defaultValue="~/.codex"
            className="w-56"
          />
        </div>
      }
    />
  );
}

function chipRow(title: string) {
  return (
    <SettingsRow
      title={title}
      control={
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          <Button variant="outline" size="sm" aria-label={`${title} model`}>
            <span data-composer-control-label>6 Astra</span>
          </Button>
          <Button variant="outline" size="sm" aria-label={`${title} effort`}>
            <span data-composer-control-label>Medium</span>
          </Button>
        </div>
      }
    />
  );
}

describe("settings layout", () => {
  it("draws selects, text inputs and chip pickers at one width, height and right edge", async () => {
    await using screen = await render(
      <SettingsSection title="Behavior">
        {selectRow("Short", "On")}
        {selectRow("Medium length", "Last user message")}
        {selectRow("Long", "Repository conventions and more")}
        {inputRow("Binary path")}
        {chipRow("Model")}
      </SettingsSection>,
      { container: wideContainer(), router: false },
    );

    const controls = [
      ...["Short", "Medium length", "Long"].map((name) =>
        page.getByRole("combobox", { name }).element(),
      ),
      page
        .getByRole("textbox", { name: "Binary path" })
        .element()
        .closest("[data-slot=input-control]")!,
      // A picker's two chips stack, each as wide and tall as a select.
      page.getByRole("button", { name: "Model model" }).element(),
      page.getByRole("button", { name: "Model effort" }).element(),
    ].map((element) => element.getBoundingClientRect());
    expect(new Set(controls.map((rect) => Math.round(rect.width)))).toEqual(new Set([240]));
    expect(new Set(controls.map((rect) => Math.round(rect.right))).size).toBe(1);
    expect(new Set(controls.map((rect) => Math.round(rect.height))).size).toBe(1);
    expect(screen.container.querySelectorAll("[data-settings-control]")).toHaveLength(5);
  });

  it("keeps a text field's placeholder readable (4.5:1) so an empty field does not read as disabled", async () => {
    await using _screen = await render(
      <div data-app-modal="">
        <SettingsSection title="Provider">
          <SettingsRow
            title="Binary path"
            control={
              <Input nativeInput size="sm" aria-label="Binary path" placeholder="~/.codex" />
            }
          />
        </SettingsSection>
      </div>,
      { container: wideContainer(), router: false },
    );

    const input = page.getByRole("textbox", { name: "Binary path" }).element();
    expect(textContrast(input, "::placeholder")).toBeGreaterThanOrEqual(4.5);
  });

  it("widens a select that sits in a narrow wrapper beside its hidden input to the control column", async () => {
    await using _screen = await render(
      <SettingsSection title="Colors">
        <SettingsRow
          title="Diff colors"
          control={
            <div className="w-full sm:w-40">
              <Select value="Auto" name="diffColors">
                <SelectTrigger size="sm" aria-label="Diff colors">
                  <SelectValue>Auto</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="Auto">Auto</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
      </SettingsSection>,
      { container: wideContainer(), router: false },
    );

    const trigger = page.getByRole("combobox", { name: "Diff colors" }).element();
    expect(Math.round(trigger.getBoundingClientRect().width)).toBe(240);
  });

  it("captions a picker pair Model and Effort, gives each trigger a chevron, and leaves a lone picker uncaptioned", async () => {
    const picker = (label: string) => (
      <Button variant="outline" size="sm" aria-label={`${label} trigger`}>
        <span data-composer-control-label>{label} value</span>
      </Button>
    );
    await using screen = await render(
      <SettingsSection title="Models">
        <SettingsRow
          title="Default model"
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <SettingsPickerField label="Model">{picker("Model")}</SettingsPickerField>
              <SettingsPickerField label="Effort">{picker("Effort")}</SettingsPickerField>
            </div>
          }
        />
        <SettingsRow
          title="Fallback model"
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <SettingsPickerField label="Model">{picker("Fallback")}</SettingsPickerField>
            </div>
          }
        />
      </SettingsSection>,
      { container: wideContainer(), router: false },
    );

    const caption = (trigger: string) =>
      page.getByRole("button", { name: trigger }).element().parentElement!.firstElementChild!;
    expect(caption("Model trigger")).toBeVisible();
    expect(caption("Model trigger").textContent).toBe("Model");
    expect(caption("Effort trigger").textContent).toBe("Effort");
    expect(getComputedStyle(caption("Fallback trigger")).display).toBe("none");
    for (const name of ["Model trigger", "Effort trigger", "Fallback trigger"]) {
      const trigger = page.getByRole("button", { name }).element();
      expect(getComputedStyle(trigger, "::after").content, name).toBe('""');
      expect(Math.round(trigger.getBoundingClientRect().width), name).toBe(240);
    }
    expect(screen.container.querySelectorAll("[data-settings-picker-field]")).toHaveLength(3);
  });

  it("starts an empty state the same distance under the page header whether its section hides its title or only repeats the page's", async () => {
    const gapUnder = async (path: string, section: ReactNode) => {
      await using screen = await render(<SettingsPageContainer>{section}</SettingsPageContainer>, {
        router: path,
      });
      const header = screen.container.querySelector("[data-settings-page-header]")!;
      const empty = screen.container.querySelector("[data-settings-empty]")!;
      return empty.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
    };
    const state = <SettingsEmptyState icon={<span />} title="Nothing yet" description="Add one." />;
    const repeated = await gapUnder(
      "/settings/scheduled-tasks",
      <SettingsSection title="Scheduled tasks" variant="plain">
        {state}
      </SettingsSection>,
    );
    const hidden = await gapUnder(
      "/settings/archived",
      <SettingsSection title="Archive" hideTitle variant="plain">
        {state}
      </SettingsSection>,
    );
    expect(Math.abs(repeated - hidden)).toBeLessThan(1.5);
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

  it("leaves a section title that only repeats the page title to screen readers", async () => {
    await using screen = await render(
      <SettingsPageContainer>
        <SettingsSection title="Chat">
          <SettingsRow title="Rich text composer" />
        </SettingsSection>
        <SettingsSection title="Composer">
          <SettingsRow title="Send shortcut" />
        </SettingsSection>
        <SettingsSection title="Chat" icon={<span aria-hidden>*</span>}>
          <SettingsRow title="Another" />
        </SettingsSection>
      </SettingsPageContainer>,
      { router: "/settings/chat" },
    );

    const heading = (name: string) =>
      [...screen.container.querySelectorAll<HTMLElement>("h2")].find(
        (candidate) => candidate.textContent === name,
      )!;
    const repeats = [...screen.container.querySelectorAll<HTMLElement>("h2")].filter((candidate) =>
      candidate.textContent?.endsWith("Chat"),
    );
    // The repeat is hidden; the same title stays when it carries an icon.
    expect(repeats.map((h) => h.getBoundingClientRect().width > 1)).toEqual([false, true]);
    expect(heading("Composer").getBoundingClientRect().width).toBeGreaterThan(1);
  });
});
