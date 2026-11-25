import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "./menu";
import { CommandDialog, CommandDialogPopup, CommandInput, Command } from "./command";
import { SearchField } from "./search-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./select";
import { ToastProvider, toastManager } from "./toast";
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

describe("read-only fields", () => {
  it("a read-only field focused with the keyboard still draws the focus border and glow", async () => {
    await using screen = await render(<Input aria-label="Shortcut" readOnly />, { router: false });
    const field = screen.container.querySelector<HTMLElement>("[data-slot=input-control]")!;
    const restBorder = getComputedStyle(field).borderTopColor;

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
});

function channels(css: string): [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function luminance([r, g, b]: [number, number, number]) {
  const linear = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(channels(a)), luminance(channels(b))].toSorted((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("switch", () => {
  it.each(["light", "dark"] as const)(
    "an off switch track is at least 3:1 against its surface and its thumb at least 3:1 against the track in %s",
    async (scheme) => {
      document.documentElement.classList.toggle("dark", scheme === "dark");
      try {
        await using screen = await render(<Switch aria-label="Notify" />, { router: false });
        const track = screen.container.querySelector<HTMLElement>("[data-slot=switch]")!;
        const thumb = screen.container.querySelector<HTMLElement>("[data-slot=switch-thumb]")!;
        const surface = document.createElement("div");
        surface.style.backgroundColor = "var(--background)";
        document.body.append(surface);
        try {
          const trackColor = getComputedStyle(track).backgroundColor;
          expect(
            contrast(trackColor, getComputedStyle(surface).backgroundColor),
          ).toBeGreaterThanOrEqual(3);
          expect(
            contrast(getComputedStyle(thumb).backgroundColor, trackColor),
          ).toBeGreaterThanOrEqual(3);
        } finally {
          surface.remove();
        }
      } finally {
        document.documentElement.classList.remove("dark");
      }
    },
  );

  it("the switch in a menu row moves its thumb with the same spring and fills its checked track the same as the Switch", async () => {
    await using screen = await render(
      <>
        <Switch aria-label="Notify" defaultChecked />
        <Menu defaultOpen>
          <MenuTrigger>Options</MenuTrigger>
          <MenuPopup>
            <MenuCheckboxItem checked variant="switch">
              Pinned
            </MenuCheckboxItem>
          </MenuPopup>
        </Menu>
      </>,
    );
    const track = screen.container.querySelector<HTMLElement>("[data-slot=switch]")!;
    const thumb = screen.container.querySelector<HTMLElement>("[data-slot=switch-thumb]")!;
    const menuTrack = document.querySelector<HTMLElement>("[data-slot=menu-switch]")!;
    const menuThumb = document.querySelector<HTMLElement>("[data-slot=menu-switch-thumb]")!;

    expect(getComputedStyle(menuTrack).backgroundColor).toBe(
      getComputedStyle(track).backgroundColor,
    );
    expect(getComputedStyle(menuThumb).transitionDuration).toBe(
      getComputedStyle(thumb).transitionDuration,
    );
    expect(getComputedStyle(menuThumb).transitionTimingFunction).toBe(
      getComputedStyle(thumb).transitionTimingFunction,
    );
  });
});

describe("toast countdown line", () => {
  const timers = () =>
    [...document.querySelectorAll<HTMLElement>("[data-slot=toast-timer]")].map(
      (line) => getComputedStyle(line).animationPlayState,
    );

  it("every timed toast's line stops while any toast is hovered, and while the window is in the background", async () => {
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    toastManager.add({ type: "info", title: "First toast", timeout: 60_000 });
    toastManager.add({ type: "info", title: "Second toast", timeout: 60_000 });
    await expect.poll(timers).toEqual(["running", "running"]);

    await userEvent.hover(page.getByText("Second toast"));
    await expect
      .poll(timers, { message: "hover pauses both, as Base UI does" })
      .toEqual(["paused", "paused"]);

    await userEvent.unhover(page.getByText("Second toast"));
    await expect.poll(timers).toEqual(["running", "running"]);

    window.dispatchEvent(new Event("blur"));
    await expect.poll(timers, { message: "window blur pauses both" }).toEqual(["paused", "paused"]);
    window.dispatchEvent(new Event("focus"));
    await expect.poll(timers).toEqual(["running", "running"]);
    toastManager.close();
  });

  it("a toast with no single dismissal timer draws no running line", async () => {
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    toastManager.add({ type: "loading", title: "Working", timeout: 60_000 });
    await expect.element(page.getByText("Working")).toBeVisible();

    const line = document.querySelector<HTMLElement>("[data-slot=toast-timer]")!;
    expect(getComputedStyle(line).animationDuration).toBe("0s");
    toastManager.close();
  });
});

async function inScheme<T>(scheme: "light" | "dark", run: () => Promise<T> | T): Promise<T> {
  document.documentElement.classList.toggle("dark", scheme === "dark");
  try {
    return await run();
  } finally {
    document.documentElement.classList.remove("dark");
  }
}

/** The computed color of a CSS value, resolved on a probe element in the page. */
function resolved(value: string, property: "color" | "backgroundColor" = "backgroundColor") {
  const probe = document.createElement("div");
  probe.style[property] = value;
  document.body.append(probe);
  try {
    return getComputedStyle(probe)[property];
  } finally {
    probe.remove();
  }
}

describe("accent fills", () => {
  it.each(["light", "dark"] as const)(
    "a primary button and an on switch are at least 3:1 against the page and the label on the button at least 4.5:1 in %s",
    (scheme) =>
      inScheme(scheme, async () => {
        await using screen = await render(
          <>
            <Button>Save</Button>
            <Switch aria-label="Notify" defaultChecked />
          </>,
          { router: false },
        );
        const page_ = resolved("var(--background)");
        const button = screen.container.querySelector<HTMLElement>("[data-slot=button]")!;
        const track = screen.container.querySelector<HTMLElement>("[data-slot=switch]")!;

        expect(contrast(getComputedStyle(button).backgroundColor, page_)).toBeGreaterThanOrEqual(3);
        expect(contrast(getComputedStyle(track).backgroundColor, page_)).toBeGreaterThanOrEqual(3);
        expect(
          contrast(getComputedStyle(button).color, getComputedStyle(button).backgroundColor),
        ).toBeGreaterThanOrEqual(4.5);
      }),
  );

  it("the light accent fill reads as gold, not olive: red clearly above green, blue low", async () => {
    await inScheme("light", async () => {
      await using screen = await render(<Button>Save</Button>, { router: false });
      const [r, g, b] = channels(
        getComputedStyle(screen.container.querySelector<HTMLElement>("[data-slot=button]")!)
          .backgroundColor,
      );
      expect(r - g, "red leads green by a gold margin").toBeGreaterThanOrEqual(35);
      expect(g - b, "green leads blue by a gold margin").toBeGreaterThanOrEqual(80);
    });
  });
});

describe("surface levels", () => {
  it.each(["light", "dark"] as const)(
    "body text is at least 4.5:1 on the base, raised and overlay surface in %s",
    (scheme) =>
      inScheme(scheme, () => {
        const text = resolved("var(--foreground)", "color");
        for (const level of ["base", "raised", "overlay"]) {
          expect(
            contrast(text, resolved(`var(--ui-surface-${level})`)),
            `text on ${level}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }),
  );

  it("on dark each level is lighter than the one below it, so panels read without blur", () =>
    inScheme("dark", () => {
      const [base, raised, overlay] = ["base", "raised", "overlay"].map((level) =>
        luminance(channels(resolved(`var(--ui-surface-${level})`))),
      );
      expect(raised!).toBeGreaterThan(base! + 0.003);
      expect(overlay!).toBeGreaterThan(raised! + 0.003);
    }));
});

describe("selected state", () => {
  it("a tile that opts in draws a brand ring and tint only while selected", async () => {
    await using screen = await render(
      <>
        <div data-testid="off" data-ui-tile aria-checked="false" role="radio" />
        <div data-testid="on" data-ui-tile aria-checked="true" role="radio" />
      </>,
      { router: false },
    );

    expect(getComputedStyle(screen.getByTestId("off").element()).boxShadow).toBe("none");
    expect(getComputedStyle(screen.getByTestId("on").element()).boxShadow).toContain("1.5px");
    expect(getComputedStyle(screen.getByTestId("on").element()).backgroundColor).not.toBe(
      getComputedStyle(screen.getByTestId("off").element()).backgroundColor,
    );
  });

  it("the selected row of a select takes the same brand tint a selected tile uses", async () => {
    await using _screen = await render(
      <Select defaultOpen defaultValue="b">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="a">Alpha</SelectItem>
          <SelectItem value="b">Beta</SelectItem>
        </SelectPopup>
      </Select>,
      { router: false },
    );
    await userEvent.hover(page.getByText("Alpha"));
    const selected = document.querySelector<HTMLElement>("[data-slot=select-item][data-selected]")!;
    const tint = resolved("var(--ui-select-tint)");

    await expect.poll(() => getComputedStyle(selected).backgroundColor).toBe(tint);
  });
});

describe("search fields", () => {
  it("the shared search field's underline becomes the focus edge when typing", async () => {
    await using screen = await render(<SearchField aria-label="Filter" shortcut="/" />, {
      router: false,
    });
    const field = screen.container.querySelector<HTMLElement>("[data-slot=search-field]")!;
    const rest = getComputedStyle(field).borderBottomColor;

    await userEvent.tab();

    await expect.poll(() => getComputedStyle(field).borderBottomColor).not.toBe(rest);
    await expect.poll(() => getComputedStyle(field).boxShadow).toContain("0px 1px 0px 0px");
    expect(screen.container.querySelector("[data-slot=kbd]")?.textContent).toBe("/");
  });

  it("the command palette field is unframed: no border or glow of its own, a 17px size and a hairline under it", async () => {
    await using _screen = await render(
      <CommandDialog open>
        <CommandDialogPopup aria-label="Command palette">
          <Command items={["One"]}>
            <CommandInput placeholder="Search" />
          </Command>
        </CommandDialogPopup>
      </CommandDialog>,
      { router: false },
    );
    const control = document.querySelector<HTMLElement>(
      "[data-slot=command-dialog-popup] [data-slot=input-control]",
    )!;
    const search = document.querySelector<HTMLElement>(
      "[data-slot=command-dialog-popup] [data-slot=search-field]",
    )!;
    const input = control.querySelector<HTMLElement>("input")!;

    input.focus();

    await expect.poll(() => getComputedStyle(search).borderBottomWidth).toBe("1px");
    expect(getComputedStyle(control).boxShadow, "no glow around the field itself").toBe("none");
    expect(getComputedStyle(control).borderTopColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(input).fontSize).toBe("17px");
  });
});
