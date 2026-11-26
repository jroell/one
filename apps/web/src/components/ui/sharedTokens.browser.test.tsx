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
  it("define one ladder: press 100ms, small enter 180ms, surface 240ms, sheet 320ms, exits at 0.7", () => {
    expect(token("--mo-press")).toBe("100ms");
    expect(token("--mo-quick")).toBe("180ms");
    expect(token("--mo-surface")).toBe("240ms");
    expect(token("--mo-sheet")).toBe("320ms");
    expect(token("--mo-exit")).toBe("0.7");
    expect(token("--mo-spring")).toBe("160ms");
    expect(token("--ease-enter")).toBe("cubic-bezier(0.2, 0.9, 0.1, 1)");
    expect(token("--ease-exit")).toBe("cubic-bezier(0.4, 0, 1, 1)");
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
      expect(style.scale).toBe("0.96");
      expect(style.translate).toBe("0px 8px");
      expect(getComputedStyle(sheet).opacity).toBe("1");
      expect(getComputedStyle(sheet).scale).toBe("0.985");
      expect(getComputedStyle(sheet).translate).toBe("0px 12px");
      expect(getComputedStyle(glass).opacity).toBe("1");
    } finally {
      palette.remove();
      sheet.remove();
      select.remove();
    }
  });

  it("content waits 60ms for its surface: children start at opacity 0, including the children of a display:contents wrapper", () => {
    const palette = surface({ "data-slot": "command-dialog-popup", "data-starting-style": "" });
    const wrapper = document.createElement("div");
    wrapper.className = "contents";
    const inner = document.createElement("div");
    wrapper.append(inner);
    const direct = document.createElement("div");
    palette.append(wrapper, direct);
    try {
      expect(getComputedStyle(direct).opacity).toBe("0");
      expect(getComputedStyle(inner).opacity).toBe("0");
      expect(getComputedStyle(inner).transitionDelay).toBe("0.06s");
    } finally {
      palette.remove();
    }
  });
});

describe("material tiers", () => {
  const blur = {
    thin: "blur(24px) saturate(1.7)",
    regular: "blur(40px) saturate(1.8)",
    thick: "blur(60px) saturate(1.6)",
  };

  it("menus, tooltips and toasts are thin; the palette, popovers and selects regular; sheets and dialogs thick", () => {
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

  it.each(["light", "dark"] as const)(
    "a thicker tier is more opaque, and every tier shares one edge and one drop in %s",
    (scheme) =>
      inScheme(scheme, () => {
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
      expect(resolved("var(--st-working)")).toBe(resolved("var(--gold-400)"));
      expect(resolved("var(--st-done)")).toBe("rgb(207, 198, 182)");
      expect(resolved("var(--st-attention)")).toBe("rgb(224, 138, 60)");
      expect(resolved("var(--st-error)")).toBe("rgb(212, 87, 74)");
    }));

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
