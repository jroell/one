import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "./menu";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
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

/** Empties the module-level toast queue when the test ends, so the next test starts clean. */
function emptyToastQueue(): Disposable {
  return { [Symbol.dispose]: () => toastManager.close() };
}

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
  it("in dark an off switch track is at least 3:1 against its surface and its thumb at least 3:1 against the track", async () => {
    document.documentElement.classList.add("dark");
    try {
      await using screen = await render(<Switch aria-label="Notify" />, { router: false });
      const track = screen.container.querySelector<HTMLElement>("[data-slot=switch]")!;
      const thumb = screen.container.querySelector<HTMLElement>("[data-slot=switch-thumb]")!;
      const trackColor = getComputedStyle(track).backgroundColor;
      expect(contrast(trackColor, resolved("var(--background)"))).toBeGreaterThanOrEqual(3);
      expect(contrast(getComputedStyle(thumb).backgroundColor, trackColor)).toBeGreaterThanOrEqual(
        3,
      );
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });

  it("in light an off switch is a warm pale track clearly lighter than the on state, and its white thumb carries a ring at least 3:1 against both the track and the page", async () => {
    await using screen = await render(
      <>
        <Switch aria-label="Off" />
        <Switch aria-label="On" defaultChecked />
      </>,
      { router: false },
    );
    const [off, on] = [...screen.container.querySelectorAll<HTMLElement>("[data-slot=switch]")];
    const thumb = off!.querySelector<HTMLElement>("[data-slot=switch-thumb]")!;
    const trackColor = getComputedStyle(off!).backgroundColor;
    expect(luminance(channels(trackColor))).toBeGreaterThan(
      luminance(channels(getComputedStyle(on!).backgroundColor)) + 0.3,
    );
    const ring = /rgb\([^)]*\)/.exec(getComputedStyle(thumb).boxShadow)![0];
    expect(contrast(ring, trackColor), "thumb ring against the track").toBeGreaterThanOrEqual(3);
    expect(
      contrast(ring, resolved("var(--background)")),
      "thumb ring against the page",
    ).toBeGreaterThanOrEqual(3);
  });

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

describe("toast", () => {
  it("draws no countdown line, since Base UI keeps its dismissal timers private and resets them on updates", async () => {
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    using _queue = emptyToastQueue();
    toastManager.add({ type: "info", title: "Timed toast", timeout: 60_000 });
    await expect.element(page.getByText("Timed toast")).toBeVisible();

    expect(document.querySelector("[data-slot=toast-timer]")).toBeNull();
    toastManager.close();
  });

  it("marks its type with a status-colored icon and draws no colored edge", async () => {
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    using _queue = emptyToastQueue();
    toastManager.add({ type: "error", title: "Could not save", timeout: 60_000 });
    await expect.element(page.getByText("Could not save").first()).toBeVisible();

    const toast = document.querySelector<HTMLElement>("[data-slot=toast-viewport] > [data-type]")!;
    const icon = toast.querySelector<SVGElement>("[data-slot=toast-icon] svg")!;
    expect(getComputedStyle(icon).color).toBe(resolved("var(--ui-danger-fg)", "color"));
    expect(getComputedStyle(toast).boxShadow).not.toContain("2px 0px 0px 0px");
    toastManager.close();
  });

  it("shows one toast at a time with a +N count, runs the Retry action of a recoverable error, and shows the waiting toast after it", async () => {
    const retry = vi.fn();
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    using _queue = emptyToastQueue();
    const errorId = toastManager.add({
      type: "error",
      title: "Could not archive",
      timeout: 60_000,
      data: { onRetry: retry },
    });
    toastManager.add({ type: "info", title: "Second notice", timeout: 60_000 });
    await expect.element(page.getByText("Could not archive").first()).toBeVisible();

    expect(document.querySelectorAll("[data-slot=toast-viewport] > [data-type]")).toHaveLength(1);
    expect(document.querySelector("[data-slot=toast-count]")?.textContent).toBe("+1");

    await userEvent.click(document.querySelector<HTMLElement>('[data-slot="toast-retry"]')!);
    expect(retry).toHaveBeenCalledOnce();
    await expect.element(page.getByText("Second notice")).toBeVisible();
    toastManager.close(errorId);
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

        // A button is told from the page by its fill or its border, whichever is stronger.
        const buttonStyle = getComputedStyle(button);
        expect(
          Math.max(
            contrast(buttonStyle.backgroundColor, page_),
            contrast(buttonStyle.borderTopColor, page_),
          ),
        ).toBeGreaterThanOrEqual(3);
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

describe("the primary button metal", () => {
  it.each(["light", "dark"] as const)(
    "is a top-lit gradient on the gold ramp with the label at least 4.5:1 at the lightest and darkest stop and no glow at rest in %s",
    (scheme) =>
      inScheme(scheme, async () => {
        await using screen = await render(<Button>Send</Button>, { router: false });
        const button = screen.container.querySelector<HTMLElement>("[data-slot=button]")!;
        const style = getComputedStyle(button);
        const stops = ["--btn-a", "--btn-b"].map((name) =>
          resolved(style.getPropertyValue(name).trim()),
        );
        expect(style.backgroundImage).toContain("linear-gradient");
        const [top, bottom] = stops.map((stop) => luminance(channels(stop)));
        expect(top!, "lit from the top").toBeGreaterThan(bottom!);
        for (const stop of stops) {
          expect(contrast(style.color, stop), `label on ${stop}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(stops[0]).toBe(resolved(scheme === "dark" ? "var(--gold-400)" : "var(--gold-500)"));
        // Rest shadows are black contact lines and inset highlights, never a gold glow.
        expect(style.boxShadow).not.toMatch(/221, 181, 90|110, 81, 24/);
      }),
  );
});

describe("the material ramp", () => {
  it.each(["light", "dark"] as const)(
    "text and muted text are at least 4.5:1 on the raised, card and floating steps in %s",
    (scheme) =>
      inScheme(scheme, () => {
        for (const step of ["raised", "card", "floating"]) {
          const surface = resolved(`var(--m-${step})`);
          for (const text of [
            "var(--foreground)",
            "var(--muted-foreground)",
            "var(--ui-muted-text)",
          ]) {
            expect(
              contrast(resolved(text, "color"), surface),
              `${text} on ${step}`,
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      }),
  );

  it("the dark card step is at least 6 levels lighter than the frame it sits in and the Usage summary one step above the cards", async () => {
    await inScheme("dark", async () => {
      await using screen = await render(
        <div data-app-modal="">
          <div className="usage-panel" data-testid="card" />
          <div className="usage-panel usage-summary" data-testid="hero" />
        </div>,
        { router: false },
      );
      const backdrop = "rgb(10 9 8)";
      const frame = composite(
        [getComputedStyle(screen.container.querySelector("[data-app-modal]")!).backgroundColor],
        backdrop,
      );
      const onFrame = (id: string) =>
        luminance(
          channels(
            composite(
              [
                getComputedStyle(screen.container.querySelector("[data-app-modal]")!)
                  .backgroundColor,
                getComputedStyle(screen.getByTestId(id).element()).backgroundColor,
              ],
              backdrop,
            ),
          ),
        );
      const [fr, fg] = channels(frame);
      const [cr, cg] = channels(
        composite(
          [
            getComputedStyle(screen.container.querySelector("[data-app-modal]")!).backgroundColor,
            getComputedStyle(screen.getByTestId("card").element()).backgroundColor,
          ],
          backdrop,
        ),
      );
      expect(cr! - fr!, "red").toBeGreaterThanOrEqual(6);
      expect(cg! - fg!, "green").toBeGreaterThanOrEqual(5);
      expect(onFrame("hero")).toBeGreaterThan(onFrame("card"));
    });
  });

  it("the dark ramp rises from base through raised and card, and every step leans warm: red above green above blue by at least 2 levels", () =>
    inScheme("dark", () => {
      const steps = ["base", "raised", "card", "floating"].map((step) =>
        channels(resolved(`var(--m-${step})`)),
      );
      const lum = steps.map((rgb) => luminance(rgb));
      expect(lum[1]!).toBeGreaterThan(lum[0]!);
      expect(lum[2]!).toBeGreaterThan(lum[1]!);
      for (const [r, g, b] of steps.slice(1)) {
        expect(r! - g!).toBeGreaterThanOrEqual(2);
        expect(g! - b!).toBeGreaterThanOrEqual(2);
      }
    }));

  it("the app canvas and the sidebar are the base step in dark, so the page and a modal over it are one dark", () =>
    inScheme("dark", () => {
      expect(resolved("var(--background)")).toBe(resolved("var(--m-base)"));
      expect(resolved("var(--sidebar)")).toBe(resolved("var(--m-base)"));
    }));
});

describe("the opaque glass fallbacks", () => {
  it("are built from core tokens, so a theme color that is defined but unusable cannot make them transparent", () => {
    const root = document.documentElement;
    root.dataset.themeId = "test-theme";
    root.style.setProperty("--app-theme-surface-overlay", "not a color");
    root.style.setProperty("--app-theme-canvas", "rgb(20, 20, 30)");
    root.style.setProperty("--app-theme-text", "rgb(240, 240, 240)");
    try {
      const [, , , alpha] = rgba(resolved("var(--m-opaque)"));
      expect(alpha).toBe(1);
    } finally {
      delete root.dataset.themeId;
      for (const name of ["surface-overlay", "canvas", "text"]) {
        root.style.removeProperty(`--app-theme-${name}`);
      }
    }
  });

  it("the no-blur rule matches the light dialog's selector specificity and sets the opaque color", () => {
    const rules: CSSSupportsRule[] = [];
    const visit = (list: CSSRuleList) => {
      for (const rule of list) {
        if (rule instanceof CSSSupportsRule && rule.conditionText.includes("backdrop-filter")) {
          rules.push(rule);
        } else if ("cssRules" in rule) {
          visit((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        visit(sheet.cssRules);
      } catch {
        // A cross-origin sheet cannot be read.
      }
    }
    const fallback = rules
      .flatMap((rule) => [...rule.cssRules])
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
      .find((rule) => rule.selectorText.includes(":root:not(.dark) .dialog-glass"));
    expect(fallback, "a no-blur rule for the light dialog").toBeDefined();
    expect(fallback!.style.getPropertyValue("background-color")).toBe("var(--m-opaque)");
  });
});

describe("surface levels in a chosen theme", () => {
  it("a custom dark theme's own raised and overlay colors win over the stepped defaults, and the glass uses them", () => {
    const root = document.documentElement;
    root.classList.add("dark");
    root.dataset.themeId = "test-theme";
    root.style.setProperty("--app-theme-surface-raised", "rgb(40, 14, 14)");
    root.style.setProperty("--app-theme-surface-overlay", "rgb(14, 14, 60)");
    root.style.setProperty("--app-theme-message-action", "rgb(200, 150, 20)");
    const probe = document.createElement("div");
    probe.className = "dropdown-glass";
    document.body.append(probe);
    try {
      expect(resolved("var(--ui-surface-raised)")).toBe(resolved("rgb(40, 14, 14)"));
      expect(resolved("var(--ui-surface-overlay)")).toBe(resolved("rgb(14, 14, 60)"));
      const [r, g, b, a] = rgba(getComputedStyle(probe).backgroundColor);
      expect(b, "the glass takes its blue from the theme's raised color").toBeGreaterThan(r + 5);
      expect(a, "and stays translucent at the default glass opacity").toBeLessThan(1);
      expect(g).toBeLessThan(b + 25);
    } finally {
      probe.remove();
      root.classList.remove("dark");
      delete root.dataset.themeId;
      root.style.removeProperty("--app-theme-surface-raised");
      root.style.removeProperty("--app-theme-surface-overlay");
      root.style.removeProperty("--app-theme-message-action");
    }
  });
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

    await expect
      .poll(() => getComputedStyle(field).borderBottomColor)
      .toBe(resolved("var(--ui-focus)"));
    expect(rest).not.toBe(resolved("var(--ui-focus)"));
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

function rgba(css: string): [number, number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}

/** Layers painted over a backdrop, nearest layer last, as one opaque color. */
function composite(layers: ReadonlyArray<string>, backdrop: string): string {
  let [r, g, b] = rgba(backdrop);
  for (const layer of layers) {
    const [lr, lg, lb, la] = rgba(layer);
    [r, g, b] = [lr * la + r * (1 - la), lg * la + g * (1 - la), lb * la + b * (1 - la)];
  }
  return `rgb(${r} ${g} ${b})`;
}

function hue([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe("modal glass", () => {
  it.each(["light", "dark"] as const)(
    "text on the modal frame and on a card is at least 4.5:1 over the darkest and lightest likely backdrop in %s",
    (scheme) =>
      inScheme(scheme, async () => {
        await using screen = await render(
          <>
            <div className="dialog-backdrop" data-testid="scrim" />
            <div data-app-modal="">
              <div data-testid="card" style={{ background: "var(--glass-card-fill)" }}>
                Card
              </div>
            </div>
          </>,
          { router: false },
        );
        const frame = getComputedStyle(screen.container.querySelector("[data-app-modal]")!);
        const card = getComputedStyle(screen.getByTestId("card").element());
        const scrim = getComputedStyle(screen.getByTestId("scrim").element());
        expect(frame.backdropFilter, "the frame blurs what is behind it").toMatch(
          /blur\(.+saturate\(/,
        );
        expect(
          getComputedStyle(screen.getByTestId("card").element()).backdropFilter,
          "a card inside the frame has no blur of its own",
        ).toBe("none");

        // Backdrop, then the scrim with the warm light at its brightest, then the frame, then a card.
        const ambient = resolved(
          `color-mix(in oklab, var(--one-brand) ${scheme === "dark" ? 20 : 12}%, transparent)`,
        );
        const backdrops =
          scheme === "light"
            ? ["rgb(252 252 252)", "rgb(120 120 120)"]
            : ["rgb(0 0 0)", "rgb(150 150 150)"];
        for (const backdrop of backdrops) {
          const behind = composite([scrim.backgroundColor, ambient], backdrop);
          const onFrame = composite([frame.backgroundColor], behind);
          const onCard = composite([frame.backgroundColor, card.backgroundColor], behind);
          for (const [surface, name] of [
            [onFrame, "frame"],
            [onCard, "card"],
          ] as const) {
            for (const text of ["var(--foreground)", "var(--ui-muted-text)"]) {
              expect(
                contrast(resolved(text, "color"), surface),
                `${text} on the ${name} over ${backdrop}`,
              ).toBeGreaterThanOrEqual(4.5);
            }
          }
        }
      }),
  );

  it.each(["light", "dark"] as const)(
    "the scrim lets most of the app show through and the frame tint leans warm, red above green above blue, in %s",
    (scheme) =>
      inScheme(scheme, async () => {
        await using screen = await render(
          <>
            <div className="dialog-backdrop" data-testid="scrim" />
            <div data-app-modal="" />
          </>,
          { router: false },
        );
        const [, , , scrimAlpha] = rgba(
          getComputedStyle(screen.getByTestId("scrim").element()).backgroundColor,
        );
        expect(scrimAlpha, "the scrim dims far less than a flat black").toBeLessThanOrEqual(0.36);
        expect(getComputedStyle(screen.getByTestId("scrim").element()).backgroundImage).toContain(
          "radial-gradient",
        );
        const [r, g, b] = rgba(
          getComputedStyle(screen.container.querySelector("[data-app-modal]")!).backgroundColor,
        );
        expect(r, "red leads green").toBeGreaterThan(g);
        expect(g, "green leads blue").toBeGreaterThan(b);
      }),
  );

  it("the frame follows the user's glass opacity: translucent by default, opaque at 100%, and a card is a faint tint", async () => {
    document.documentElement.classList.add("dark");
    try {
      await using screen = await render(
        <div data-app-modal="">
          <div data-testid="card" style={{ background: "var(--glass-card-fill)" }} />
        </div>,
        { router: false },
      );
      const frame = screen.container.querySelector<HTMLElement>("[data-app-modal]")!;
      const alpha = () => rgba(getComputedStyle(frame).backgroundColor)[3];
      document.documentElement.style.setProperty("--glass-opacity", "80%");
      expect(alpha()).toBeCloseTo(0.72, 1);
      document.documentElement.style.setProperty("--glass-opacity", "50%");
      expect(alpha(), "the least opaque fill still carries text").toBeCloseTo(0.4, 1);
      document.documentElement.style.setProperty("--glass-opacity", "100%");
      expect(alpha()).toBeCloseTo(1, 1);
      expect(
        rgba(getComputedStyle(screen.getByTestId("card").element()).backgroundColor)[3],
      ).toBeLessThan(0.1);
    } finally {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.removeProperty("--glass-opacity");
    }
  });

  it("a custom theme's raised color tints its frame, not the default theme's", async () => {
    const root = document.documentElement;
    root.classList.add("dark");
    root.dataset.themeId = "test-theme";
    root.style.setProperty("--app-theme-surface-overlay", "rgb(10, 40, 10)");
    root.style.setProperty("--app-theme-message-action", "rgb(200, 150, 20)");
    try {
      await using screen = await render(<div data-app-modal="" />, { router: false });
      const [r, g, b] = rgba(
        getComputedStyle(screen.container.querySelector("[data-app-modal]")!).backgroundColor,
      );
      expect(g - r, "green leads red").toBeGreaterThan(8);
      expect(g - b, "green leads blue").toBeGreaterThan(8);
    } finally {
      root.classList.remove("dark");
      delete root.dataset.themeId;
      root.style.removeProperty("--app-theme-surface-overlay");
      root.style.removeProperty("--app-theme-message-action");
    }
  });

  it("a theme that sets neither an action nor an accent color still gets an opaque-enough, legible frame and menu", async () => {
    const root = document.documentElement;
    root.classList.add("dark");
    root.dataset.themeId = "test-theme";
    root.style.setProperty("--app-theme-surface-overlay", "rgb(30, 30, 40)");
    try {
      await using screen = await render(
        <>
          <div data-app-modal="" />
          <div className="dropdown-glass" data-testid="menu" />
        </>,
        { router: false },
      );
      for (const surface of [
        screen.container.querySelector("[data-app-modal]")!,
        screen.getByTestId("menu").element(),
      ]) {
        const fill = getComputedStyle(surface).backgroundColor;
        expect(rgba(fill)[3], "the fill is not transparent").toBeGreaterThanOrEqual(0.4);
        const behind = composite([fill], "rgb(120 120 120)");
        expect(contrast(resolved("var(--foreground)", "color"), behind)).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    } finally {
      root.classList.remove("dark");
      delete root.dataset.themeId;
      root.style.removeProperty("--app-theme-surface-overlay");
    }
  });
});

describe("status tokens", () => {
  const statuses = ["danger", "warning", "success", "info"] as const;

  it.each(["light", "dark"] as const)(
    "each status text is at least 4.5:1 on the page and on its tint, its fill at least 3:1 against the page, and white text at least 4.5:1 on its solid in %s",
    (scheme) =>
      inScheme(scheme, () => {
        const page_ = resolved("var(--background)");
        for (const status of statuses) {
          const fg = resolved(`var(--ui-${status}-fg)`, "color");
          const tint = resolved(`var(--ui-${status}-tint)`);
          expect(contrast(fg, page_), `${status} text on the page`).toBeGreaterThanOrEqual(4.5);
          expect(
            contrast(fg, composite([tint], page_)),
            `${status} text on its tint`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            contrast(resolved(`var(--ui-${status}-fill)`), page_),
            `${status} fill on the page`,
          ).toBeGreaterThanOrEqual(3);
          expect(
            contrast(
              resolved("var(--ui-on-solid)", "color"),
              resolved(`var(--ui-${status}-solid)`),
            ),
            `white on ${status} solid`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }),
  );

  it.each(["light", "dark"] as const)(
    "warning is orange, clearly apart from the gold brand fill, in %s",
    (scheme) =>
      inScheme(scheme, () => {
        const warning = hue(channels(resolved("var(--ui-warning-fill)")));
        const gold = hue(channels(resolved("var(--ui-fill)")));
        expect(gold - warning).toBeGreaterThanOrEqual(12);
      }),
  );
});

describe("status tokens across the app", () => {
  it("the app's older warning, success, info and error tokens follow the status set in the default theme, and a chosen theme keeps its own", () => {
    for (const [old, now] of [
      ["--warning", "--ui-warning-fill"],
      ["--success", "--ui-success-fill"],
      ["--info", "--ui-info-fill"],
      ["--destructive", "--ui-danger-fill"],
    ] as const) {
      expect(resolved(`var(${old})`), old).toBe(resolved(`var(${now})`));
    }

    const root = document.documentElement;
    root.dataset.themeId = "test-theme";
    root.style.setProperty("--app-theme-warning", "rgb(10, 200, 10)");
    try {
      expect(resolved("var(--warning)")).toBe(resolved("rgb(10, 200, 10)"));
    } finally {
      delete root.dataset.themeId;
      root.style.removeProperty("--app-theme-warning");
    }
  });
});

describe("numbers", () => {
  it("a number is sans with tabular figures, and monospace stays for code", async () => {
    await using screen = await render(
      <>
        <span className="one-num" data-testid="num">
          1,204
        </span>
        <span data-testid="body">Body</span>
      </>,
      { router: false },
    );
    const num = getComputedStyle(screen.getByTestId("num").element());
    expect(num.fontVariantNumeric).toContain("tabular-nums");
    expect(num.fontFamily).toBe(getComputedStyle(screen.getByTestId("body").element()).fontFamily);
    expect(num.fontFamily).not.toMatch(/mono/i);
  });
});

describe("selected palette row", () => {
  it("the highlighted palette row takes the brand tint every list row uses", async () => {
    await using _screen = await render(
      <Command items={["One"]}>
        <CommandList>
          {(item: string) => (
            <CommandItem active value={item}>
              {item}
            </CommandItem>
          )}
        </CommandList>
      </Command>,
      { router: false },
    );
    const row = document.querySelector<HTMLElement>("[data-slot=command-item]")!;

    await expect
      .poll(() => getComputedStyle(row).backgroundColor)
      .toBe(resolved("var(--ui-highlight)"));
  });
});
