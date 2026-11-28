import { textContrast } from "../../../test/contrast";
import { render } from "../../../test/render";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "../../index.css";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
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

  it("stretches a Model and an Effort picker to the row width, one under the other, in a 360 px row", async () => {
    const narrow = document.createElement("div");
    narrow.style.width = "360px";
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
      </SettingsSection>,
      { container: narrow, router: false },
    );

    const model = page.getByRole("button", { name: "Model trigger" }).element();
    const effort = page.getByRole("button", { name: "Effort trigger" }).element();
    const row = screen.container.querySelector("[data-settings-control]")!.getBoundingClientRect();
    // Full width of the row's control column, and the second under the first.
    expect(Math.round(model.getBoundingClientRect().width)).toBe(Math.round(row.width));
    expect(Math.round(effort.getBoundingClientRect().width)).toBe(Math.round(row.width));
    expect(effort.getBoundingClientRect().top).toBeGreaterThan(
      model.getBoundingClientRect().bottom,
    );
  });

  it("keeps a picker's chevron a 14 px mark on a touch screen, where the shared button would stretch it over the whole trigger", async () => {
    await using _screen = await render(<div data-app-modal="" />, { router: false });
    // The shared button gives its ::after a full-size absolute box on a coarse pointer, which a
    // desktop test run cannot trigger; the settings rule must overrule that box on its own.
    const rules = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .filter(
        (rule): rule is CSSStyleRule =>
          rule instanceof CSSStyleRule &&
          rule.selectorText.includes("data-composer-control-chevron") &&
          rule.selectorText.includes("::after"),
      );
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.style.position).toBe("static");
      expect(rule.style.inlineSize).toBe("0.875rem");
      expect(rule.style.minInlineSize).toBe("0px");
    }
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

  it("draws a picker trigger and a select trigger in one style: fill, edge, radius, height, padding, chevron", async () => {
    await using _screen = await render(
      <div data-app-modal="">
        <SettingsSection title="Models">
          {selectRow("Permissions", "Full access")}
          <SettingsRow
            title="Model"
            control={
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <Button variant="outline" size="sm" aria-label="Model picker">
                  <span data-composer-control-label>6 Astra</span>
                </Button>
              </div>
            }
          />
        </SettingsSection>
      </div>,
      { container: wideContainer(), router: false },
    );

    const select = page.getByRole("combobox", { name: "Permissions" }).element();
    const picker = page.getByRole("button", { name: "Model picker" }).element();
    const look = (element: Element) => {
      const style = getComputedStyle(element);
      return {
        fill: style.backgroundColor,
        edge: style.borderTopColor,
        radius: style.borderTopLeftRadius,
        height: style.height,
        padding: style.paddingLeft,
        inset: style.boxShadow,
      };
    };
    expect(look(picker)).toEqual(look(select));
    // The select draws its chevron as an icon, the picker draws the same one as a mask.
    const icon = select.querySelector("svg")!;
    const mask = getComputedStyle(picker, "::after");
    expect(mask.width).toBe(getComputedStyle(icon).width);
    expect(mask.opacity).toBe(getComputedStyle(icon).opacity);
  });

  it("centers the page column in the space beside the rail and stops it at 720 px", async () => {
    const pane = document.createElement("div");
    pane.style.width = "1150px";
    await using screen = await render(
      <div data-app-modal="">
        <SettingsPageContainer>
          <SettingsSection title="Section">
            <div>Row</div>
          </SettingsSection>
        </SettingsPageContainer>
      </div>,
      { container: pane, router: "/settings/general" },
    );
    const column = screen.container.querySelector<HTMLElement>("[data-settings-page]")!;
    const scroller = screen.container.querySelector<HTMLElement>("[data-settings-page-scroll]")!;
    const box = column.getBoundingClientRect();
    const space = scroller.getBoundingClientRect();
    expect(box.width).toBeLessThanOrEqual(720);
    expect(Math.abs(box.left - space.left - (space.right - box.right))).toBeLessThanOrEqual(1);
  });

  it("opens a swapped confirmation and a revealed line with the shared motion tokens, never a cut", async () => {
    await using screen = await render(
      <div data-app-modal="">
        <SettingsPageContainer>
          <span data-settings-swap="">Sign out every other client?</span>
          <span data-settings-reveal="" data-open="">
            <span>When</span>
          </span>
        </SettingsPageContainer>
      </div>,
      { router: "/settings/general" },
    );
    const quick = getComputedStyle(document.documentElement).getPropertyValue("--mo-quick").trim();
    const seconds = (value: string) =>
      value.endsWith("ms") ? Number.parseFloat(value) / 1000 : Number.parseFloat(value);

    // A page has no entrance animation of its own: opened with the sheet, it is simply there,
    // and a page change fades the previous page out over it (settingsPageCrossfade.browser.test).
    const pageStyle = getComputedStyle(screen.container.querySelector("[data-settings-page]")!);
    expect(pageStyle.animationName).toBe("none");

    const swap = getComputedStyle(screen.container.querySelector("[data-settings-swap]")!);
    expect(swap.animationName).toBe("settings-swap-in");
    // The confirmation follows the line before it by the content delay.
    expect(Number.parseFloat(swap.animationDelay)).toBeCloseTo(0.06, 3);

    const reveal = screen.container.querySelector<HTMLElement>("[data-settings-reveal]")!;
    expect(Number.parseFloat(getComputedStyle(reveal).transitionDuration)).toBe(seconds(quick));
    expect(getComputedStyle(reveal.firstElementChild!).transitionDelay).toBe("0.06s");
  });

  it("keeps the shortcut sheet's scrollbar out of sight while the pointer only rests on the list", async () => {
    await using screen = await render(
      <div data-shortcuts-sheet="" style={{ height: 160, width: 320 }}>
        <ScrollArea>
          <div style={{ height: 800 }}>A long list</div>
        </ScrollArea>
      </div>,
      { router: false },
    );
    const viewport = screen.container.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )!;
    await userEvent.hover(viewport);
    const bar = screen.container.querySelector<HTMLElement>(
      '[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]',
    )!;
    // Hovering used to fade it in; only scrolling does now.
    await vi.waitFor(() => expect(bar.hasAttribute("data-hovering")).toBe(true));
    expect(getComputedStyle(bar).opacity).toBe("0");
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
      .element(page.getByText("Writing messages, follow-ups and how tool activity appears."))
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
