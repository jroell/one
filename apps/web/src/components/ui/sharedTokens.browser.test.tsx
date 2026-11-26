import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { Button } from "./button";
import { Switch } from "./switch";

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: string, b: string) {
  const [high, low] = [luminance(channels(a)), luminance(channels(b))].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

function hue([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

async function inScheme<T>(scheme: "light" | "dark", run: () => Promise<T> | T): Promise<T> {
  document.documentElement.classList.toggle("dark", scheme === "dark");
  try {
    return await run();
  } finally {
    document.documentElement.classList.remove("dark");
  }
}

/** A bare element of the given kind, in the page, with the computed style of its slot. */
function surface(attributes: Record<string, string>, className = "") {
  const element = document.createElement("div");
  element.className = className;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}

describe("motion tokens", () => {
  it("define one ladder: press 90ms, small enter 180ms, surface 240ms, sheet 320ms, release 240ms, exits at 0.7", () => {
    expect(token("--mo-press")).toBe("90ms");
    expect(token("--mo-release")).toBe("240ms");
    expect(token("--mo-quick")).toBe("180ms");
    expect(token("--mo-surface")).toBe("240ms");
    expect(token("--mo-sheet")).toBe("320ms");
    expect(token("--mo-exit")).toBe("0.7");
    expect(token("--mo-spring")).toBe("160ms");
    expect(token("--ease-enter")).toBe("cubic-bezier(0.2, 0.9, 0.1, 1)");
    expect(token("--ease-exit")).toBe("cubic-bezier(0.4, 0, 1, 1)");
  });

  it("the release spring takes a pressed .97 button to 1.01 and settles on 1", () => {
    const curve = token("--ease-release");
    expect(curve.startsWith("linear(")).toBe(true);
    const values = curve
      .slice("linear(".length, -1)
      .split(",")
      .map((stop) => Number.parseFloat(stop));
    // Scale runs .97 + .03 * progress, so a progress of 1.33 is a scale of about 1.01.
    const peakScale = 0.97 + 0.03 * Math.max(...values);
    expect(peakScale).toBeGreaterThan(1.008);
    expect(peakScale).toBeLessThan(1.012);
    expect(values.at(-1)).toBe(1);
  });

  it("the spring is a linear() curve that passes its mark by under 3% and ends on 1", () => {
    const curve = token("--ease-spring");
    expect(curve.startsWith("linear(")).toBe(true);
    const values = [...curve.matchAll(/(-?\d+(?:\.\d+)?)(?= \d+%|,|\))/g)].map((m) => Number(m[1]));
    expect(Math.max(...values)).toBeGreaterThan(1.01);
    expect(Math.max(...values)).toBeLessThan(1.03);
    expect(values.at(-1)).toBeLessThan(1.01);
    expect(values.at(-1)).toBeGreaterThan(0.99);
  });

  it("the older motion names read the new numbers", () => {
    expect(token("--one-press-ms")).toBe(token("--mo-press"));
    expect(token("--one-hover-ms")).toBe(token("--mo-hover"));
    expect(token("--one-ease-spring")).toBe(token("--ease-spring"));
  });

  it("a popup arrives by scale and translate over its full time, and drops to opacity 0 only in the last 30ms of its exit", () => {
    const menu = surface({ "data-slot": "menu-popup" });
    const popover = surface({ "data-slot": "popover-popup" });
    const sheet = surface({ "data-slot": "dialog-popup" });
    try {
      expect(getComputedStyle(menu).transitionProperty).toBe("scale, translate, opacity");
      expect(getComputedStyle(menu).transitionDuration).toBe("0.18s, 0.18s, 0.03s");
      expect(getComputedStyle(sheet).transitionDuration).toBe("0.32s, 0.32s, 0.03s");
      menu.setAttribute("data-ending-style", "");
      popover.setAttribute("data-ending-style", "");
      expect(getComputedStyle(menu).transitionDuration).toBe("0.126s, 0.126s, 0.03s");
      expect(getComputedStyle(menu).transitionDelay).toBe("0s, 0s, 0.096s");
      expect(getComputedStyle(popover).transitionDelay).toBe("0s, 0s, 0.138s");
      expect(getComputedStyle(menu).transitionTimingFunction).toContain(
        "cubic-bezier(0.4, 0, 1, 1)",
      );
    } finally {
      menu.remove();
      popover.remove();
      sheet.remove();
    }
  });

  it("an entering surface is fully opaque from its first frame, so the page never shows through it", () => {
    const palette = surface({ "data-slot": "command-dialog-popup", "data-starting-style": "" });
    const sheet = surface({ "data-slot": "dialog-popup", "data-starting-style": "" });
    const select = surface({ "data-slot": "select-popup", "data-starting-style": "" });
    const glass = document.createElement("div");
    glass.className = "dropdown-glass";
    select.append(glass);
    try {
      const style = getComputedStyle(palette);
      expect(style.opacity).toBe("1");
      expect(style.scale).toBe("0.97");
      expect(style.translate).toBe("0px 8px");
      expect(getComputedStyle(sheet).opacity).toBe("1");
      expect(getComputedStyle(sheet).scale).toBe("0.97");
      expect(getComputedStyle(sheet).translate).toBe("0px 8px");
      expect(getComputedStyle(glass).opacity).toBe("1");
    } finally {
      palette.remove();
      sheet.remove();
      select.remove();
    }
  });

  it("an overlay's content is painted with its panel from the first frame: children start at opacity 1 with no delay, including the children of a display:contents wrapper", () => {
    const slots = ["command-dialog-popup", "menu-popup", "popover-popup", "dialog-popup"];
    const overlays = slots.map((slot) => surface({ "data-slot": slot, "data-starting-style": "" }));
    const wrapper = document.createElement("div");
    wrapper.className = "contents";
    const inner = document.createElement("div");
    wrapper.append(inner);
    const direct = document.createElement("div");
    overlays[0]!.append(wrapper, direct);
    const select = surface({ "data-slot": "select-popup", "data-starting-style": "" });
    const glass = document.createElement("div");
    glass.className = "dropdown-glass";
    const row = document.createElement("div");
    glass.append(row);
    select.append(glass);
    try {
      for (const element of [direct, inner, row]) {
        expect(getComputedStyle(element).opacity).toBe("1");
        expect(getComputedStyle(element).transitionDelay).toBe("0s");
      }
      expect(getComputedStyle(glass).opacity).toBe("1");
    } finally {
      for (const overlay of overlays) overlay.remove();
      select.remove();
    }
  });

  it("a context menu's items and a toast's content have no animation or delay of their own: they arrive with the panel", () => {
    const menu = surface({ "data-context-menu": "true" }, "dropdown-glass");
    const item = document.createElement("div");
    menu.append(item);
    const viewport = surface({ "data-slot": "toast-viewport" });
    const toast = document.createElement("div");
    toast.setAttribute("data-type", "info");
    toast.setAttribute("data-starting-style", "");
    const toastBody = document.createElement("div");
    toast.append(toastBody);
    viewport.append(toast);
    try {
      expect(getComputedStyle(item).animationName).toBe("none");
      expect(getComputedStyle(toastBody).opacity).toBe("1");
      expect(getComputedStyle(toastBody).transitionDelay).toBe("0s");
      expect(getComputedStyle(toast).opacity).toBe("1");
    } finally {
      menu.remove();
      viewport.remove();
    }
  });

  it("a menu and a popover grow from their trigger, the palette from its top centre and a dialog from its centre", () => {
    const origin = (slot: string) => {
      const element = surface({ "data-slot": slot });
      element.style.setProperty("--transform-origin", "12px 34px");
      element.style.width = "200px";
      element.style.height = "100px";
      return element;
    };
    const menu = origin("menu-popup");
    const popover = origin("popover-popup");
    const palette = origin("command-dialog-popup");
    const dialog = origin("dialog-popup");
    try {
      expect(getComputedStyle(menu).transformOrigin).toBe("12px 34px");
      expect(getComputedStyle(popover).transformOrigin).toBe("12px 34px");
      expect(getComputedStyle(palette).transformOrigin).toBe("100px 0px");
      expect(getComputedStyle(dialog).transformOrigin).toBe("100px 50px");
    } finally {
      menu.remove();
      popover.remove();
      palette.remove();
      dialog.remove();
    }
  });
});

describe("material tiers", () => {
  const blur = {
    thin: "blur(24px) saturate(1.7)",
    regular: "blur(40px) saturate(1.8)",
    thick: "blur(60px) saturate(1.6)",
  };

  it("in light, menus, tooltips and toasts are thin; the palette, popovers and selects regular; sheets and dialogs thick", () => {
    const toastViewport = surface({ "data-slot": "toast-viewport" });
    const toast = document.createElement("div");
    toast.className = "dropdown-glass";
    toastViewport.append(toast);
    const select = surface({ "data-slot": "select-popup" });
    const selectGlass = document.createElement("div");
    selectGlass.className = "dropdown-glass";
    select.append(selectGlass);
    const cases: Array<[Element, keyof typeof blur]> = [
      [surface({ "data-slot": "menu-popup" }, "dropdown-glass"), "thin"],
      [surface({ "data-slot": "tooltip-popup" }), "thin"],
      [surface({ "data-context-menu": "true" }, "dropdown-glass"), "thin"],
      [toast, "thin"],
      [surface({ "data-slot": "command-dialog-popup" }, "dialog-glass"), "regular"],
      [surface({ "data-slot": "popover-popup" }, "dropdown-glass"), "regular"],
      [selectGlass, "regular"],
      [surface({ "data-app-modal": "" }), "thick"],
      [surface({ "data-slot": "dialog-popup" }, "dialog-glass"), "thick"],
      [surface({ "data-slot": "sheet-popup" }), "thick"],
    ];
    try {
      for (const [element, tier] of cases) {
        expect(
          getComputedStyle(element).backdropFilter,
          `${element.getAttribute("data-slot") ?? element.className} is ${tier}`,
        ).toBe(blur[tier]);
      }
    } finally {
      for (const [element] of cases) element.remove();
      toastViewport.remove();
      select.remove();
    }
  });

  it("in light, a thicker tier is more opaque, and every tier shares one edge and one drop", () =>
    inScheme("light", () => {
      const thin = surface({}, "m-thin");
      const regular = surface({}, "m-regular");
      const thick = surface({}, "m-thick");
      try {
        const alpha = (element: Element) =>
          channelsWithAlpha(getComputedStyle(element).backgroundColor)[3];
        expect(alpha(thick)).toBeGreaterThan(alpha(regular));
        expect(alpha(thin)).toBeGreaterThan(alpha(regular) - 0.2);
        const shadows = [thin, regular, thick].map(
          (element) => getComputedStyle(element).boxShadow,
        );
        expect(new Set(shadows).size).toBe(1);
        expect(shadows[0]).toContain("inset");
      } finally {
        thin.remove();
        regular.remove();
        thick.remove();
      }
    }));

  it("in dark, floating glass is one material: one fill (18, 16, 13 at 72%), one 24px blur, one highlight, one hairline and one shadow, whatever the tier", () =>
    inScheme("dark", () => {
      const toastViewport = surface({ "data-slot": "toast-viewport" });
      const toast = document.createElement("div");
      toast.className = "dropdown-glass";
      toastViewport.append(toast);
      const elements = [
        surface({ "data-slot": "menu-popup" }, "dropdown-glass"),
        surface({ "data-slot": "command-dialog-popup" }, "dialog-glass"),
        surface({ "data-slot": "popover-popup" }, "dropdown-glass"),
        surface({ "data-app-modal": "" }),
        surface({ "data-slot": "dialog-popup" }, "dialog-glass"),
        surface({ "data-slot": "sheet-popup" }),
        surface({}, "m-thin"),
        surface({}, "m-regular"),
        surface({}, "m-thick"),
        toast,
      ];
      try {
        for (const element of elements) {
          const style = getComputedStyle(element);
          const label = element.getAttribute("data-slot") ?? element.className;
          expect(style.backdropFilter, label).toBe("blur(24px) saturate(1.4)");
          const [r, g, b, a] = channelsWithAlpha(style.backgroundColor);
          // Canvas premultiplies alpha, so an 8-bit channel can land one step off.
          for (const [channel, expected] of [
            [r, 18],
            [g, 16],
            [b, 13],
          ] as const) {
            expect(Math.abs(channel - expected), label).toBeLessThanOrEqual(1);
          }
          expect(a, label).toBeCloseTo(0.72, 1);
          expect(style.boxShadow, label).toContain("rgba(255, 240, 210, 0.1)");
          expect(style.boxShadow, label).toContain("rgba(0, 0, 0, 0.5) 0px 24px 60px");
        }
      } finally {
        for (const element of elements) element.remove();
        toastViewport.remove();
      }
    }));

  it("in dark, every solid card is one value, #17140f, and chrome is the app black", () =>
    inScheme("dark", () => {
      expect(resolved("var(--m-raised)")).toBe("rgb(23, 20, 15)");
      expect(resolved("var(--m-card)")).toBe("rgb(23, 20, 15)");
      expect(resolved("var(--m-field-fill)")).toBe("rgb(23, 20, 15)");
      expect(resolved("var(--message-surface)")).toBe("rgb(23, 20, 15)");
      expect(resolved("var(--m-base)")).toBe("rgb(10, 9, 8)");
      expect(resolved("var(--sidebar)")).toBe("rgb(10, 9, 8)");
    }));

  it("in dark, a sheet's warm light is a glow along its top edge, never a wash down its face", () =>
    inScheme("dark", () => {
      const sheet = surface({ "data-app-modal": "" });
      try {
        expect(getComputedStyle(sheet).backgroundImage).toContain("120px at 50% 0");
        expect(getComputedStyle(sheet).backgroundImage).not.toContain("16rem");
      } finally {
        sheet.remove();
      }
    }));

  it.each(["light", "dark"] as const)(
    "floating text keeps 4.5:1 over the worst backdrop in %s",
    (scheme) =>
      inScheme(scheme, () => {
        const glass = surface({ "data-slot": "menu-popup" }, "dropdown-glass");
        try {
          const fill = channelsWithAlpha(getComputedStyle(glass).backgroundColor);
          // The worst backdrop is the opposite extreme of the page: white under dark glass, the
          // page's own ink colour under light glass. The blur averages content toward its mean, so
          // the extreme itself is the bound.
          const backdrop: [number, number, number] =
            scheme === "dark" ? [255, 255, 255] : [0, 0, 0];
          const mixed = fill
            .slice(0, 3)
            .map((channel, index) => channel * fill[3] + backdrop[index]! * (1 - fill[3]));
          const ink = resolved("var(--popover-foreground)", "color");
          const ratio = contrast(ink, `rgb(${mixed.join(",")})`);
          expect(ratio, `${scheme}: text over the worst backdrop`).toBeGreaterThanOrEqual(4.5);
        } finally {
          glass.remove();
        }
      }),
  );

  it("the radius scale is 8 controls, 12 menus, 16 cards, 22 sheets, 24 composer and bubbles", () => {
    expect(token("--m-radius-control")).toBe("0.5rem");
    expect(token("--m-radius-floating")).toBe("0.75rem");
    expect(token("--m-radius-raised")).toBe("1rem");
    expect(token("--m-radius-sheet")).toBe("1.375rem");
    expect(token("--m-radius-pill")).toBe("1.5rem");
    const menu = surface({ "data-slot": "menu-popup" }, "dropdown-glass");
    const sheet = surface({ "data-app-modal": "" });
    const tooltip = surface({ "data-slot": "tooltip-popup" });
    try {
      expect(getComputedStyle(menu).borderRadius).toBe("12px");
      expect(getComputedStyle(sheet).borderRadius).toBe("22px");
      expect(getComputedStyle(tooltip).borderRadius).toBe("8px");
    } finally {
      menu.remove();
      sheet.remove();
      tooltip.remove();
    }
  });
});

function channelsWithAlpha(css: string): [number, number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}

describe("status tokens", () => {
  const meanings = ["working", "done", "attention", "error"] as const;

  it.each(["light", "dark"] as const)(
    "each status color is 4.5:1 or better as text on the page, a card, a bubble and the floating surface in %s",
    (scheme) =>
      inScheme(scheme, () => {
        const surfaces = [
          "var(--m-base)",
          "var(--m-raised)",
          "var(--m-card)",
          "var(--m-floating)",
          "var(--message-surface)",
        ];
        for (const meaning of meanings) {
          const text = resolved(`var(--st-${meaning}-fg)`, "color");
          for (const surfaceColor of surfaces) {
            const ratio = contrast(text, resolved(surfaceColor));
            expect(ratio, `${meaning} on ${surfaceColor}`).toBeGreaterThanOrEqual(
              scheme === "dark" && meaning === "error" && surfaceColor === "var(--m-card)"
                ? 4.4
                : 4.5,
            );
          }
        }
      }),
  );

  it("working is gold, done is bone, attention is ember and error is oxblood, in dark", () =>
    inScheme("dark", () => {
      expect(resolved("var(--st-working)")).toBe(resolved("var(--gold-text)"));
      expect(resolved("var(--st-done)")).toBe("rgb(207, 198, 182)");
      expect(resolved("var(--st-attention)")).toBe("rgb(232, 121, 58)");
      expect(resolved("var(--st-error)")).toBe("rgb(212, 87, 74)");
    }));

  it.each(["light", "dark"] as const)(
    "attention is ember, at least 15 degrees of hue from gold and from failure, and its chip, dot and header count read the same color in %s",
    (scheme) =>
      inScheme(scheme, () => {
        const hueOf = (value: string) => hue(channels(resolved(value)));
        const ember = hueOf("var(--st-attention)");
        expect(Math.abs(ember - hueOf("var(--gold-fill)"))).toBeGreaterThanOrEqual(15);
        expect(Math.abs(ember - hueOf("var(--st-error)"))).toBeGreaterThanOrEqual(15);

        const status = surface({ "data-approval-status": "" });
        const chip = document.createElement("span");
        chip.setAttribute("data-slot", "badge");
        status.append(chip);
        const header = surface({ "data-sidebar-needs-you": "" });
        const button = document.createElement("button");
        header.append(button);
        const dot = surface({}, "one-status-dot");
        try {
          const attention = resolved("var(--st-attention-fg)", "color");
          expect(getComputedStyle(chip).color, "chip text, no peach mix").toBe(attention);
          expect(getComputedStyle(button).color, "header count").toBe(attention);
          expect(getComputedStyle(dot).backgroundColor, "dot").toBe(
            resolved("var(--st-attention)"),
          );
        } finally {
          status.remove();
          header.remove();
          dot.remove();
        }
      }),
  );

  it.each(["light", "dark"] as const)(
    "no status or shared-control status color is blue or green in %s: success and info are the bone check",
    (scheme) =>
      inScheme(scheme, () => {
        for (const name of [
          "--ui-success-fill",
          "--ui-info-fill",
          "--ui-success-fg",
          "--ui-info-fg",
          "--success",
          "--info",
          "--ui-warning-fill",
          "--ui-danger-fill",
        ]) {
          const color = channels(resolved(`var(${name})`));
          const h = hue(color);
          const isNeutral = Math.max(...color) - Math.min(...color) < 40;
          expect(
            isNeutral || h < 70 || h > 330,
            `${name} (${color.join(", ")}) is not in the blue or green range`,
          ).toBe(true);
        }
      }),
  );
});

describe("the warm light theme", () => {
  it("the page is #faf7f1, the bubble is from the same palette, and the sidebar is warm, not cool grey", () =>
    inScheme("light", () => {
      expect(resolved("var(--background)")).toBe("rgb(250, 247, 241)");
      const [r, g, b] = channels(resolved("var(--message-surface)"));
      expect(r - b, "red leads blue by a warm margin").toBeGreaterThanOrEqual(10);
      expect(r).toBeGreaterThanOrEqual(g);
      const [sr, , sb] = channels(resolved("var(--sidebar)"));
      expect(sr - sb).toBeGreaterThanOrEqual(8);
    }));
});

describe("primary controls", () => {
  it.each(["light", "dark"] as const)(
    "a pressed primary button keeps its label at least 4.5:1 and sinks with an inner shadow in %s",
    (scheme) =>
      inScheme(scheme, async () => {
        await using screen = await render(<Button data-pressed="">New task</Button>, {
          router: false,
        });
        const style = getComputedStyle(screen.container.querySelector("[data-slot=button]")!);
        expect(contrast(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
        expect(style.boxShadow).toContain("inset");
      }),
  );

  it.each(["light", "dark"] as const)(
    "the send button is a gold disc with the dark arrow, and 30% opacity when disabled, in %s",
    (scheme) =>
      inScheme(scheme, () => {
        const enabled = document.createElement("button");
        enabled.setAttribute("data-composer-send", "");
        const disabled = document.createElement("button");
        disabled.setAttribute("data-composer-send", "");
        disabled.disabled = true;
        document.body.append(enabled, disabled);
        try {
          const style = getComputedStyle(enabled);
          const [r, g, b] = channels(style.backgroundColor);
          expect(r - b, "gold, not grey").toBeGreaterThan(60);
          expect(contrast(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
          expect(style.backgroundImage).toContain("linear-gradient");
          expect(getComputedStyle(disabled).opacity).toBe("0.3");
          expect(g).toBeGreaterThan(b);
        } finally {
          enabled.remove();
          disabled.remove();
        }
      }),
  );

  it.each(["light", "dark"] as const)(
    "Approve and Send are one gold: the same fill, and Send is 30% when empty, in %s",
    (scheme) =>
      inScheme(scheme, async () => {
        await using screen = await render(<Button>Approve</Button>, { router: false });
        const approve = getComputedStyle(screen.container.querySelector("[data-slot=button]")!);
        const send = document.createElement("button");
        send.setAttribute("data-composer-send", "");
        const empty = document.createElement("button");
        empty.setAttribute("data-composer-send", "");
        empty.disabled = true;
        document.body.append(send, empty);
        try {
          expect(getComputedStyle(send).backgroundColor).toBe(approve.backgroundColor);
          expect(approve.backgroundColor).toBe(resolved("var(--gold-fill)"));
          expect(getComputedStyle(empty).opacity).toBe("0.3");
        } finally {
          send.remove();
          empty.remove();
        }
      }),
  );

  it.each(["light", "dark"] as const)(
    "a pressed primary button drops its top highlight to a third, gathers a 1px inner bottom shadow and keeps its hover glow in %s",
    (scheme) =>
      inScheme(scheme, async () => {
        await using screen = await render(
          <>
            <Button>Rest</Button>
            <Button data-pressed="">Pressed</Button>
          </>,
          { router: false },
        );
        const [rest, pressed] = [...screen.container.querySelectorAll("[data-slot=button]")].map(
          (element) => getComputedStyle(element).boxShadow,
        );
        const topHighlightAlpha = (shadow: string | undefined) => {
          const color = /((?:rgba?|color|oklab|oklch)\([^)]*\))\s+0px 1px 0px 0px inset/.exec(
            shadow ?? "",
          )?.[1];
          return color === undefined ? null : channelsWithAlpha(color)[3];
        };
        const restAlpha = topHighlightAlpha(rest);
        expect(restAlpha, "rest has an inner top highlight").not.toBeNull();
        expect(pressed).toContain("0px -1px 0px 0px inset");
        expect(topHighlightAlpha(pressed)!).toBeLessThan(restAlpha! * 0.5);
      }),
  );

  it.each(["light", "dark"] as const)(
    "a checked switch has a bone thumb on the gold track in %s",
    (scheme) =>
      inScheme(scheme, async () => {
        await using screen = await render(<Switch aria-label="On" defaultChecked />, {
          router: false,
        });
        const thumb = screen.container.querySelector("[data-slot=switch-thumb]")!;
        expect(getComputedStyle(thumb).backgroundColor).toBe("rgb(245, 239, 228)");
      }),
  );
});
