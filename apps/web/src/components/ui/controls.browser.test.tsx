import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Radio, RadioGroup } from "./radio-group";
import { Switch } from "./switch";
import { Toggle } from "./toggle";

const standaloneControls = [
  { name: "button", ui: <Button>Save</Button>, role: "button" },
  { name: "toggle", ui: <Toggle>Bold</Toggle>, role: "button" },
  { name: "switch", ui: <Switch aria-label="Notify" />, role: "switch" },
  { name: "checkbox", ui: <Checkbox aria-label="Remember" />, role: "checkbox" },
  {
    name: "radio",
    ui: (
      <RadioGroup aria-label="Mode">
        <Radio aria-label="Fast" value="fast" />
      </RadioGroup>
    ),
    role: "radio",
  },
] as const;

describe("shared control focus", () => {
  it.each(standaloneControls)(
    "a $name focused with the keyboard draws a 2px focus outline 2px clear of its edge",
    async ({ ui, role }) => {
      await using _screen = await render(ui, { router: false });

      await userEvent.tab();

      const control = page.getByRole(role).element();
      expect(document.activeElement).toBe(control);
      const style = getComputedStyle(control);
      expect(style.outlineStyle, "the outline is drawn, not the browser default").toBe("solid");
      expect(style.outlineWidth).toBe("2px");
      expect(style.outlineOffset).toBe("2px");
    },
  );

  it("a text field focused with the keyboard takes the focus color on its border and a glow outside it", async () => {
    await using screen = await render(<Input aria-label="Name" />, { router: false });
    const field = screen.container.querySelector<HTMLElement>("[data-slot=input-control]")!;
    const restBorder = getComputedStyle(field).borderTopColor;
    expect(getComputedStyle(field).boxShadow).not.toContain("0px 0px 0px 4px");

    await userEvent.tab();

    await expect
      .poll(() => getComputedStyle(field).borderTopColor, {
        message: "border takes the ring color",
      })
      .not.toBe(restBorder);
    await expect
      .poll(() => getComputedStyle(field).boxShadow, {
        message: "a glow settles outside the border",
      })
      .toContain("0px 0px 0px 4px");
  });

  it("a field marked invalid keeps its error mark when it has focus", async () => {
    await using screen = await render(<Input aria-invalid aria-label="Name" />, { router: false });
    const field = screen.container.querySelector<HTMLElement>("[data-slot=input-control]")!;

    await userEvent.tab();

    expect(getComputedStyle(field, "::after").content).toBe('""');
    expect(getComputedStyle(field, "::after").width).toBe("15px");
  });
});

describe("disabled shared controls", () => {
  it("a disabled button is skipped by Tab and does not run its click handler", async () => {
    const onClick = vi.fn();
    await using _screen = await render(
      <>
        <Button disabled onClick={onClick}>
          Save
        </Button>
        <Button>Cancel</Button>
      </>,
      { router: false },
    );

    await userEvent.tab();
    expect(document.activeElement).toBe(page.getByRole("button", { name: "Cancel" }).element());

    await userEvent.click(page.getByRole("button", { name: "Save" }), { force: true });
    expect(onClick).not.toHaveBeenCalled();
  });
});

/** The reduced-motion block of the stylesheet, as the browser parsed it. */
function reducedMotionRule(selector: string): CSSStyleRule | undefined {
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSMediaRule)) continue;
      if (!rule.conditionText.includes("prefers-reduced-motion: reduce")) continue;
      for (const inner of rule.cssRules) {
        if (inner instanceof CSSStyleRule && inner.selectorText.includes(selector)) return inner;
      }
    }
  }
  return undefined;
}

describe("shared control motion", () => {
  it("reduced motion stops the skeleton, the check draw-in and the press scale", () => {
    expect(reducedMotionRule('[data-slot="skeleton"]')?.style.animationName).toBe("none");
    expect(
      reducedMotionRule('[data-slot="checkbox-indicator"] svg path')?.style.animationName,
    ).toBe("none");
    expect(reducedMotionRule("[data-button]:active")?.style.scale).toBe("1");
  });
});
