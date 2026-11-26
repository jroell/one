import { GTProvider } from "gt-react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { UsageProviderChart } from "./UsageProviderChart";

const days = ["2026-08-01", "2026-08-02", "2026-08-03"];
const daily = [
  {
    day: "2026-08-01",
    costUsd: 30,
    totalTokens: 300,
    byProvider: new Map([
      ["codex" as const, { costUsd: 20, totalTokens: 200 }],
      ["claude" as const, { costUsd: 10, totalTokens: 100 }],
    ]),
  },
  {
    day: "2026-08-03",
    costUsd: 5,
    totalTokens: 50,
    byProvider: new Map([["claude" as const, { costUsd: 5, totalTokens: 50 }]]),
  },
];

/** Bars grow in once on mount; measure them after that, not while they scale. */
const grown = () => Promise.all(document.getAnimations().map((animation) => animation.finished));

const chart = (resolution: "day" | "hour") => (
  <UsageProviderChart
    providers={["codex", "claude"]}
    days={days}
    daily={daily as never}
    hours={[]}
    hourly={[]}
    metric="cost"
    referenceTime={undefined}
    resolution={resolution}
    timeZone="UTC"
    hour12={false}
  />
);

describe("UsageProviderChart daily bars", () => {
  it("draws one bar per day and keeps the data table for screen readers", async () => {
    await using screen = await render(chart("day"), { router: false });
    expect(screen.container.querySelectorAll(".usage-bars-day")).toHaveLength(3);
    expect(screen.container.querySelector("table caption")?.textContent).toBe(
      "Daily cost by provider",
    );
    // The last day has only Claude, the first has both.
    const segments = [...screen.container.querySelectorAll(".usage-bars-day")].map(
      (day) => day.querySelectorAll(".usage-bars-segment").length,
    );
    expect(segments).toEqual([2, 0, 1]);
  });

  it("walks the days with the arrow keys and names each provider and the total", async () => {
    await using screen = await render(chart("day"), { router: false });
    const tooltip = () => screen.container.querySelector(".usage-tooltip")?.textContent ?? "";
    const plot = screen.getByRole("group", { name: "Daily cost by provider" });
    plot.element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(tooltip()).toContain("Aug 1"));
    expect(tooltip()).toContain("Codex");
    expect(tooltip()).toContain("$20.00");
    expect(tooltip()).toContain("$30.00");

    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    await vi.waitFor(() => expect(tooltip()).toContain("Aug 3"));
    expect(tooltip()).toContain("$5.00");

    await userEvent.keyboard("{End}");
    await vi.waitFor(() => expect(tooltip()).toContain("Aug 3"));
    await userEvent.keyboard("{Home}");
    await vi.waitFor(() => expect(tooltip()).toContain("Aug 1"));

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(tooltip()).toBe(""));
  });

  it("keeps a continuous area for the past 24 hours", async () => {
    await using screen = await render(chart("hour"), { router: false });
    expect(screen.container.querySelector(".usage-bars-day")).toBeNull();
    expect(screen.container.querySelector("svg path")).not.toBeNull();
  });

  it("announces the keyboard-selected period and its values, and keeps it when the pointer leaves", async () => {
    await using screen = await render(chart("day"), { router: false });
    const plot = screen.getByRole("group", { name: "Daily cost by provider" });
    plot.element().focus();
    await userEvent.keyboard("{ArrowRight}");
    const announced = () => screen.container.querySelector('[role="status"]')?.textContent ?? "";
    await vi.waitFor(() => expect(announced()).toContain("Aug 1"));
    expect(announced()).toContain("Codex $20.00");
    expect(announced()).toContain("Claude Code $10.00");
    expect(announced()).toContain("Total $30.00");

    // The pointer visits the plot and leaves: the keyboard's day stays selected.
    await userEvent.hover(plot);
    await userEvent.unhover(plot);
    expect(screen.container.querySelector(".usage-tooltip")?.textContent).toContain("Aug 1");
    expect(announced()).toContain("Aug 1");

    // Stepping on announces the next day.
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(announced()).toContain("Aug 2"));
  });

  it("describes the keys in days on the daily view and in hours on the 24-hour view", async () => {
    await using daily = await render(chart("day"), { router: false });
    expect(daily.container.querySelector('[role="group"]')?.getAttribute("aria-description")).toBe(
      "Use the left and right arrow keys to move between days",
    );
    await using hourly = await render(chart("hour"), { router: false });
    expect(hourly.container.querySelector('[role="group"]')?.getAttribute("aria-description")).toBe(
      "Use the left and right arrow keys to move between hours",
    );
  });

  it("paints a stack at exactly its axis height: its top meets the gridline and a trace value adds nothing", async () => {
    const busy = {
      day: "2026-08-02",
      costUsd: 1000,
      totalTokens: 1000,
      byProvider: new Map([
        ["codex" as const, { costUsd: 999.99, totalTokens: 999.99 }],
        ["claude" as const, { costUsd: 0.01, totalTokens: 0.01 }],
      ]),
    };
    await using screen = await render(
      <UsageProviderChart
        providers={["codex", "claude"]}
        days={["2026-08-02"]}
        daily={[busy] as never}
        hours={[]}
        hourly={[]}
        metric="cost"
        referenceTime={undefined}
        resolution="day"
        timeZone="UTC"
        hour12={false}
      />,
      { router: false },
    );
    await grown();
    const segments = [...screen.container.querySelectorAll<HTMLElement>(".usage-bars-segment")];
    const gridTops = [
      ...screen.container.querySelectorAll<HTMLElement>(".usage-bars-gridline"),
    ].map((line) => line.getBoundingClientRect().top);
    const stackTop = Math.min(...segments.map((segment) => segment.getBoundingClientRect().top));
    // The scale's top tick is $1,000, the day's total: the stack's top sits on that gridline.
    expect(Math.abs(stackTop - Math.min(...gridTops))).toBeLessThan(0.75);
    // The trace value is as thin as its share of the axis, not padded to a visible minimum.
    const heights = segments.map((segment) => segment.getBoundingClientRect().height);
    expect(Math.min(...heights)).toBeLessThan(0.1);
    const total = heights.reduce((sum, height) => sum + height, 0);
    const baseline = Math.max(...gridTops);
    expect(Math.abs(baseline - stackTop - total)).toBeLessThan(0.75);

    screen.getByRole("group", { name: "Daily cost by provider" }).element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() =>
      expect(screen.container.querySelector(".usage-tooltip")?.textContent).toContain("$1,000.00"),
    );
  });

  it("boxes the plot only for keyboard focus, quietly, and not when the pointer is on it", async () => {
    await using screen = await render(chart("day"), { router: false });
    const plot = screen.getByRole("group", { name: "Daily cost by provider" }).element();
    await userEvent.hover(plot);
    expect(getComputedStyle(plot).outlineStyle).toBe("none");
    await userEvent.unhover(plot);

    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(plot);
    const outline = getComputedStyle(plot);
    expect(outline.outlineStyle).toBe("solid");
    expect(outline.outlineWidth).toBe("1px");
  });

  it("lights the hovered day as a halo behind its bar that ends at the bar's top", async () => {
    await using screen = await render(chart("day"), { router: false });
    screen.getByRole("group", { name: "Daily cost by provider" }).element().focus();
    await userEvent.keyboard("{ArrowRight}");
    const day = await vi.waitFor(() => {
      const hovered = screen.container.querySelector<HTMLElement>(".usage-bars-day[data-hover]");
      expect(hovered).not.toBeNull();
      return hovered!;
    });
    await grown();
    const halo = getComputedStyle(day, "::before");
    const bars = [...day.querySelectorAll<HTMLElement>(".usage-bars-segment")];
    const barWidth = bars[0]!.getBoundingClientRect().width;
    const barHeight = bars.reduce((sum, bar) => sum + bar.getBoundingClientRect().height, 0);
    // It starts at the axis and rises only a few pixels above the bar, not up to the top of the plot.
    const haloHeight = Number.parseFloat(halo.height);
    expect(haloHeight).toBeGreaterThanOrEqual(barHeight);
    expect(haloHeight - barHeight).toBeLessThan(8);
    expect(Number.parseFloat(halo.width)).toBeGreaterThanOrEqual(barWidth);
  });

  it("gives each tooltip row a swatch in its series colour", async () => {
    await using screen = await render(chart("day"), { router: false });
    screen.getByRole("group", { name: "Daily cost by provider" }).element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(screen.container.querySelector(".usage-tooltip")).not.toBeNull());
    const swatches = [
      ...screen.container.querySelectorAll<HTMLElement>(".usage-tooltip-swatch"),
    ].map((swatch) => getComputedStyle(swatch).backgroundColor);
    const bars = [
      ...screen.container.querySelectorAll<HTMLElement>(".usage-bars-day")[0]!.children,
    ].map((segment) => getComputedStyle(segment).backgroundColor);
    expect(swatches).toHaveLength(2);
    expect(swatches.toSorted()).toEqual(bars.toSorted());
  });

  it.each(["dark", "light"] as const)(
    "paints Codex as a quiet warm bone in %s, never white or full ink",
    async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      try {
        await using screen = await render(chart("day"), { router: false });
        const codex = screen.container.querySelector<HTMLElement>(
          ".usage-bars-day .usage-bars-segment",
        );
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.fillStyle = getComputedStyle(codex!).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
        const brightest = Math.max(r, g, b);
        // Mid-tone on dark, deep on light; warm (red above blue) in both.
        if (theme === "dark") expect(brightest).toBeGreaterThan(120);
        if (theme === "dark") expect(brightest).toBeLessThan(200);
        if (theme === "light") expect(brightest).toBeLessThan(110);
        expect(r - b).toBeGreaterThanOrEqual(8);
      } finally {
        document.documentElement.classList.remove("dark");
      }
    },
  );

  it("leaves a provider with nothing that day out of the tooltip and the announcement", async () => {
    await using screen = await render(chart("day"), { router: false });
    screen.getByRole("group", { name: "Daily cost by provider" }).element().focus();
    await userEvent.keyboard("{End}");
    await vi.waitFor(() => expect(screen.container.querySelector(".usage-tooltip")).not.toBeNull());
    // The last day has only Claude, so Codex's $0.00 row is not listed.
    const tooltip = screen.container.querySelector(".usage-tooltip")!.textContent ?? "";
    expect(tooltip).toContain("Claude Code");
    expect(tooltip).not.toContain("Codex");
    expect(screen.container.querySelector('[role="status"]')?.textContent).not.toContain("Codex");
  });

  it("holds the axis labels at 4.5:1 on the light panel", async () => {
    await using screen = await render(chart("day"), { router: false });
    const label = screen.container.querySelector<HTMLElement>(".usage-axis-label")!;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = getComputedStyle(label).color;
    context.fillRect(0, 0, 1, 1);
    const channels = Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3)).map((value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const ink = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    const panel = 0.91;
    expect((panel + 0.05) / (ink + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it("places the Floating-material tooltip absolutely, as the plot positions it", async () => {
    await using screen = await render(chart("day"), { router: false });
    screen.getByRole("group", { name: "Daily cost by provider" }).element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(screen.container.querySelector(".usage-tooltip")).not.toBeNull());
    const tooltip = screen.container.querySelector<HTMLElement>(".usage-tooltip")!;
    expect(tooltip.classList.contains("m-floating")).toBe(true);
    expect(getComputedStyle(tooltip).position).toBe("absolute");
  });

  it("keeps selection and position paired when the pointer and the keyboard are mixed, and Escape dismisses both", async () => {
    await using screen = await render(chart("day"), { router: false });
    const plot = screen.getByRole("group", { name: "Daily cost by provider" }).element();
    const tooltip = () => screen.container.querySelector<HTMLElement>(".usage-tooltip");
    const pointerAt = (share: number) => {
      const bounds = plot.getBoundingClientRect();
      plot.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: bounds.left + bounds.width * share,
          clientY: bounds.top + bounds.height * 0.5,
        }),
      );
    };

    plot.focus();
    pointerAt(0.9);
    await vi.waitFor(() => expect(tooltip()?.textContent).toContain("Aug 3"));

    // Escape with the pointer still parked over the plot: nothing stays open.
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(tooltip()).toBeNull());

    // The next navigation key selects its own day and places the tooltip at that day, not at the
    // pointer's old coordinates.
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(tooltip()?.textContent).toContain("Aug 1"));
    const bounds = plot.getBoundingClientRect();
    const slotX = bounds.left + (bounds.width * 0.5) / 3;
    const shown = tooltip()!.getBoundingClientRect();
    expect(shown.left).toBeGreaterThanOrEqual(slotX - 1);
    expect(shown.left).toBeLessThan(slotX + 24);

    // The pointer takes over while it moves and hands back to the keyboard's day when it leaves.
    pointerAt(0.9);
    await vi.waitFor(() => expect(tooltip()?.textContent).toContain("Aug 3"));
    plot.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    plot.dispatchEvent(new MouseEvent("mouseleave"));
    await vi.waitFor(() => expect(tooltip()?.textContent).toContain("Aug 1"));
  });

  it("moves within one bar without re-observing the plot, and places a keyboard day again after a resize", async () => {
    const container = document.createElement("div");
    container.style.width = "600px";
    await using screen = await render(chart("day"), { container, router: false });
    const plot = screen.getByRole("group", { name: "Daily cost by provider" }).element();
    const tooltip = () => screen.container.querySelector<HTMLElement>(".usage-tooltip");
    const pointerAt = (share: number) => {
      const bounds = plot.getBoundingClientRect();
      plot.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: bounds.left + bounds.width * share,
          clientY: bounds.top + bounds.height * 0.5,
        }),
      );
    };

    const observed = vi.spyOn(ResizeObserver.prototype, "observe");
    try {
      pointerAt(0.05);
      await vi.waitFor(() => expect(tooltip()?.textContent).toContain("Aug 1"));
      const afterFirstMove = observed.mock.calls.length;
      const firstLeft = plot.style.getPropertyValue("--usage-tooltip-left");
      for (const share of [0.08, 0.12, 0.2, 0.3]) pointerAt(share);
      await vi.waitFor(() =>
        expect(plot.style.getPropertyValue("--usage-tooltip-left")).not.toBe(firstLeft),
      );
      expect(tooltip()?.textContent).toContain("Aug 1");
      expect(observed.mock.calls.length).toBe(afterFirstMove);
    } finally {
      observed.mockRestore();
    }

    // The keyboard's day has no coordinates of its own: it follows the plot when it is resized.
    plot.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    plot.dispatchEvent(new MouseEvent("mouseleave"));
    plot.focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    await vi.waitFor(() => expect(tooltip()?.textContent).toContain("Aug 2"));
    const slotLeft = () => {
      const bounds = plot.getBoundingClientRect();
      return tooltip()!.getBoundingClientRect().left - bounds.left;
    };
    const wide = slotLeft();
    container.style.width = "300px";
    await vi.waitFor(() => expect(slotLeft()).toBeLessThan(wide - 40));
  });

  it("grows each bar from the baseline once on mount, by transform only", async () => {
    await using screen = await render(chart("day"), { router: false });
    const day = screen.container.querySelector<HTMLElement>(".usage-bars-day")!;
    // The origin is the bottom edge, so the bar grows up from the axis.
    expect(getComputedStyle(day).transformOrigin.split(" ")[1]).toBe(getComputedStyle(day).height);
    const growing = day
      .getAnimations()
      .filter((a) => (a as CSSAnimation).animationName === "usage-grow");
    expect(growing).toHaveLength(1);
    const properties = (growing[0]!.effect as KeyframeEffect)
      .getKeyframes()
      .flatMap((frame) => Object.keys(frame))
      .filter((name) => !["offset", "easing", "composite", "computedOffset"].includes(name));
    expect(new Set(properties)).toEqual(new Set(["transform"]));

    // A new selection does not replay it.
    await grown();
    screen.getByRole("group", { name: "Daily cost by provider" }).element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(screen.container.querySelector(".usage-tooltip")).not.toBeNull());
    expect(
      day.getAnimations().filter((a) => (a as CSSAnimation).animationName === "usage-grow"),
    ).toHaveLength(0);
  });

  it("lets the tooltip finish leaving on the axis it arrived on before it is removed", async () => {
    await using screen = await render(chart("day"), { router: false });
    const plot = screen.getByRole("group", { name: "Daily cost by provider" }).element();
    plot.focus();
    await userEvent.keyboard("{ArrowRight}");
    const tooltip = await vi.waitFor(() => {
      const found = screen.container.querySelector<HTMLElement>(".usage-tooltip");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(getComputedStyle(tooltip).animationName).toBe("usage-tip-in");

    await userEvent.keyboard("{Escape}");
    // Still there, leaving: the exit is its own animation, shorter than the enter.
    await vi.waitFor(() => expect(tooltip.hasAttribute("data-closing")).toBe(true));
    const leaving = getComputedStyle(tooltip);
    expect(leaving.animationName).toBe("usage-tip-out");
    expect(Number.parseFloat(leaving.animationDuration) * 1000).toBeCloseTo(180 * 0.7, 0);
    const axis = (name: string) =>
      document
        .getAnimations()
        .flatMap((a) =>
          (a as CSSAnimation).animationName === name
            ? (a.effect as KeyframeEffect)
                .getKeyframes()
                .map((frame) => String(frame["transform"] ?? ""))
            : [],
        );
    expect(
      [...axis("usage-tip-in"), ...axis("usage-tip-out")].every(
        (value) =>
          ["", "none"].includes(value) || /^(translateY\(|matrix\(1, 0, 0, 1, 0, )/.test(value),
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(screen.container.querySelector(".usage-tooltip")).toBeNull());
  });

  it("names each series at the end of the 24-hour area, none touching another and none outside the plot", async () => {
    const start = Date.parse("2026-08-01T00:00:00.000Z");
    const hours = Array.from({ length: 24 }, (_, index) =>
      new Date(start + index * 3_600_000).toISOString(),
    );
    // Four providers, three of them with almost the same share at the end: the labels must spread.
    const hourly = hours.map((hourStart, index) => ({
      day: "2026-08-01",
      hourStart,
      costUsd: 0,
      totalTokens: 0,
      byProvider: new Map([
        ["codex" as const, { costUsd: 50 + index, totalTokens: 0 }],
        ["claude" as const, { costUsd: 1, totalTokens: 0 }],
        ["grok" as const, { costUsd: 1, totalTokens: 0 }],
        ["muse" as const, { costUsd: 1, totalTokens: 0 }],
      ]),
    }));
    await using screen = await render(
      <div style={{ width: 900 }}>
        <UsageProviderChart
          providers={["codex", "claude", "grok", "muse"]}
          days={[]}
          daily={[]}
          hours={hours}
          hourly={hourly as never}
          metric="cost"
          referenceTime={undefined}
          resolution="hour"
          timeZone="UTC"
          hour12={false}
        />
      </div>,
      { router: false },
    );
    const labels = await vi.waitFor(() => {
      const found = [...screen.container.querySelectorAll<HTMLElement>(".usage-area-label")];
      expect(found.map((label) => label.textContent).toSorted()).toEqual([
        "Claude Code",
        "Codex",
        "Grok Build",
        "Muse Code",
      ]);
      return found;
    });
    const boxes = labels
      .map((label) => label.getBoundingClientRect())
      .toSorted((a, b) => a.top - b.top);
    for (let at = 1; at < boxes.length; at += 1) {
      expect(boxes[at]!.top).toBeGreaterThanOrEqual(boxes[at - 1]!.bottom);
    }
    const plot = screen.container.querySelector(".usage-area-labels")!.getBoundingClientRect();
    for (const box of boxes) {
      expect(box.top).toBeGreaterThanOrEqual(plot.top);
      expect(box.bottom).toBeLessThanOrEqual(plot.bottom);
    }
    // The bunched ones are joined to their series by leaders.
    expect(screen.container.querySelectorAll(".usage-area-leaders path")).toHaveLength(4);
  });

  it("sets the other series back while one provider is focused", async () => {
    await using screen = await render(
      <UsageProviderChart
        providers={["codex", "claude"]}
        days={days}
        daily={daily as never}
        hours={[]}
        hourly={[]}
        metric="cost"
        focusedProvider="claude"
        referenceTime={undefined}
        resolution="day"
        timeZone="UTC"
        hour12={false}
      />,
      { router: false },
    );
    const segments = [...screen.container.querySelectorAll<HTMLElement>(".usage-bars-segment")];
    expect(segments.length).toBeGreaterThan(1);
    const opacityOf = (segment: HTMLElement) => getComputedStyle(segment).opacity;
    await vi.waitFor(() => {
      // Claude's segments stay full; Codex's fall back.
      const claude = segments.filter((segment) => !segment.hasAttribute("data-dim"));
      const others = segments.filter((segment) => segment.hasAttribute("data-dim"));
      expect(claude.length).toBeGreaterThan(0);
      expect(others.length).toBeGreaterThan(0);
      for (const segment of claude) expect(opacityOf(segment)).toBe("1");
      for (const segment of others) expect(Number(opacityOf(segment))).toBeLessThan(0.5);
    });
  });

  // Last in the file: choosing a locale in the provider stays in effect for later tests.
  it("joins the announced values with the locale's list format", async () => {
    // Japanese joins unit lists with a space, so a plain ", " join cannot satisfy this.
    const locale = "ja";
    const values = new Intl.ListFormat(locale, { style: "short", type: "unit" }).format([
      "Codex $20.00",
      "Claude Code $10.00",
    ]);
    expect(values).not.toBe("Codex $20.00, Claude Code $10.00");
    await using screen = await render(
      <GTProvider locale={locale} translations={{ [locale]: {} }}>
        {chart("day")}
      </GTProvider>,
      { router: false },
    );
    screen.getByRole("group", { name: "Daily cost by provider" }).element().focus();
    await userEvent.keyboard("{ArrowRight}");
    const announced = () => screen.container.querySelector('[role="status"]')?.textContent ?? "";
    await vi.waitFor(() => expect(announced()).toContain(`: ${values}. Total $30.00`));
  });
});
