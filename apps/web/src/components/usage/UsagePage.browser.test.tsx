import type { UsageBucket, UsageProviderKind } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import type { EnvironmentUsageStatus } from "../../state/usage";
import { UsagePage } from "./UsagePage";
import { saveUsagePagePreferences } from "./usagePagePreferences";
import { bucket, freshProviderCounts, status, summary } from "./usageFixtures";

const view = vi.hoisted(() => ({
  environments: [] as unknown[],
  partial: false,
}));

// The page reads its figures through useUsage; the test supplies them and keeps everything else
// (merging, the cache, the skeleton, the headline) real.
vi.mock(import("../../state/usage"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useUsage: ((window: unknown) => {
      const environments = view.environments as readonly EnvironmentUsageStatus[];
      const selected = environments;
      const answered = selected.filter((environment) => environment.summary !== null);
      const merged = actual.mergeAnsweredUsage(selected.filter((e) => e.canReadDiagnostics));
      return {
        merged,
        environments,
        selectedEnvironments: selected,
        isPending: answered.length === 0,
        shown: answered.length === 0 ? null : { window, merged },
        isPartial: view.partial,
        refresh: async () => undefined,
      };
    }) as never,
  };
});

const open = (windowDays: 1 | 7 | 30 | 90 = 30, hidden: readonly UsageProviderKind[] = []) => {
  saveUsagePagePreferences({ metric: "cost", windowDays, hiddenProviders: hidden });
  return render(<UsagePage />, { router: "/usage" });
};

describe("UsagePage reopening", () => {
  it("shows a partial total at full strength with an Updating note, and none once settled", async () => {
    view.environments = [
      status("desk", { isPending: true, summary: summary("desk", [["codex", 40]]) }),
    ];
    view.partial = false;
    await using screen = await open();
    await expect.element(page.getByText("Updating…")).toBeVisible();
    const hero = document.querySelector<HTMLElement>(".usage-hero");
    expect(getComputedStyle(hero!).opacity).toBe("1");
    await expect.element(page.getByText(/Codex was 100% of \$40\.00/)).toBeVisible();

    view.environments = [status("desk", { summary: summary("desk", [["codex", 40]]) })];
    await screen.rerender(<UsagePage />);
    await expect.element(page.getByText("Updating…")).not.toBeInTheDocument();
  });

  it("keeps the view switch in the header and puts the filters and period in one row under the headline", async () => {
    view.partial = false;
    view.environments = [status("desk", { summary: summary("desk", [["codex", 40]]) })];
    const { innerWidth, innerHeight } = window;
    await page.viewport(1280, 800);
    await using screen = await open(30);
    await expect.element(page.getByRole("group", { name: "Usage period" })).toBeVisible();
    const header = document.querySelector("header")!;
    expect(header.querySelector('[aria-label="Usage metric"]')).not.toBeNull();
    expect(header.querySelector('[aria-label="Usage period"]')).toBeNull();
    expect(header.querySelector(".usage-chips")).toBeNull();

    const controls = document.querySelector<HTMLElement>(".usage-controls")!;
    expect(document.querySelector(".usage-headline-block")?.nextElementSibling).toBe(controls);
    expect(controls.querySelector('[aria-label="Usage period"]')).not.toBeNull();
    expect(controls.querySelectorAll(".usage-chip")).toHaveLength(2);

    // Limits have no period, and the filters stay where they were.
    await page.getByRole("button", { name: "Limits", exact: true }).first().click();
    await vi.waitFor(() => {
      const limitsControls = document.querySelector<HTMLElement>(".usage-controls");
      expect(limitsControls?.querySelectorAll(".usage-chip")).toHaveLength(2);
      expect(limitsControls?.querySelector('[aria-label="Usage period"]')).toBeNull();
    });
    await screen.rerender(<UsagePage />);
    await page.viewport(innerWidth, innerHeight);
  });

  it("fits the filters and the period on one row at 390px without cutting a label", async () => {
    view.partial = false;
    view.environments = [status("desk", { summary: summary("desk", [["codex", 40]]) })];
    const { innerWidth, innerHeight } = window;
    await page.viewport(390, 844);
    try {
      await using _screen = await open(30);
      await expect.element(page.getByRole("combobox", { name: "Usage period" })).toBeVisible();
      const controls = document.querySelector<HTMLElement>(".usage-controls")!;
      const items = [
        ...controls.querySelectorAll<HTMLElement>(
          '.usage-chip, .usage-period-select [data-slot="select-trigger"]',
        ),
      ];
      expect(items).toHaveLength(3);
      const centres = items.map((item) => {
        const box = item.getBoundingClientRect();
        return box.top + box.height / 2;
      });
      expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(1);
      for (const item of items) {
        // The elements that carry text; an icon's box is not a label.
        const parts = [item, ...item.querySelectorAll("*")].filter(
          (part): part is HTMLElement =>
            part instanceof HTMLElement &&
            [...part.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim()),
        );
        for (const part of parts) {
          expect(part.scrollWidth, `${item.textContent} is cut`).toBeLessThanOrEqual(
            part.clientWidth + 1,
          );
        }
      }
      expect(controls.scrollWidth).toBeLessThanOrEqual(controls.clientWidth);
    } finally {
      await page.viewport(innerWidth, innerHeight);
    }
  });

  it("lets go of a pinned provider that has no data in the new period, and says nothing is dimmed", async () => {
    view.partial = false;
    view.environments = [
      status("desk", {
        summary: summary("desk", [
          ["codex", 40],
          ["claude", 60],
        ]),
      }),
    ];
    await using screen = await open(30);
    const rows = await vi.waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>(".usage-provider")];
      expect(found).toHaveLength(2);
      return found;
    });
    const dimmed = () => document.querySelectorAll(".usage-provider[data-dim]").length;
    const line = () => document.querySelector('[role="status"].sr-only')?.textContent ?? "";
    const pinned = rows.find((row) => row.textContent?.startsWith("Codex"))!;
    pinned.click();
    await vi.waitFor(() => expect(dimmed()).toBeGreaterThan(0));
    expect(line()).toMatch(/^Showing Codex in the chart\./);

    // Another period where Codex has nothing: its row is gone, so nothing may stay dimmed.
    view.environments = [status("desk", { summary: summary("desk", [["claude", 60]]) })];
    await screen.rerender(<UsagePage />);
    await vi.waitFor(() => expect(document.querySelectorAll(".usage-provider")).toHaveLength(1));
    expect(dimmed()).toBe(0);
    expect(line()).toBe("Codex is not in this view, so no provider is dimmed.");
  });

  it("lights a provider's series on a tap or on keyboard focus, clears it on a second tap or Escape, and says so", async () => {
    view.partial = false;
    view.environments = [
      status("desk", {
        summary: summary("desk", [
          ["codex", 40],
          ["claude", 60],
        ]),
      }),
    ];
    const { innerWidth, innerHeight } = window;
    await page.viewport(1280, 800);
    try {
      await using _screen = await open(30);
      const rows = await vi.waitFor(() => {
        const found = [...document.querySelectorAll<HTMLElement>(".usage-provider")];
        expect(found).toHaveLength(2);
        return found;
      });
      // The other rows set back with the other series; the chart's own dimming is tested on it.
      const dimmed = () => document.querySelectorAll(".usage-provider[data-dim]").length;
      const status = () => document.querySelector('[role="status"].sr-only')?.textContent ?? "";
      expect(dimmed()).toBe(0);

      // A tap keeps it, a second tap on the same row lets go.
      rows[0]!.click();
      await vi.waitFor(() => expect(dimmed()).toBeGreaterThan(0));
      expect(rows[0]!.getAttribute("aria-pressed")).toBe("true");
      expect(rows[0]!.hasAttribute("data-dim")).toBe(false);
      expect(rows[1]!.hasAttribute("data-dim")).toBe(true);
      expect(status()).toMatch(/^Showing (Codex|Claude Code) in the chart\./);
      rows[0]!.click();
      await vi.waitFor(() => expect(dimmed()).toBe(0));
      expect(status()).toBe("");

      // Keyboard focus does the same; Escape clears it without closing the page.
      rows[0]!.focus();
      await userEvent.keyboard("{Tab}");
      await vi.waitFor(() => expect(dimmed()).toBeGreaterThan(0));
      const label = ["Codex", "Claude Code"].find((name) =>
        document.activeElement?.textContent?.startsWith(name),
      );
      expect(label).toBeDefined();
      expect(status()).toContain(label);
      await userEvent.keyboard("{Escape}");
      await vi.waitFor(() => expect(dimmed()).toBe(0));
      // A dismissed dialog starts its exit transition at once, so it never does within this window.
      await expect(
        vi.waitFor(
          () =>
            expect(
              document.querySelector('[role="dialog"]')?.hasAttribute("data-ending-style"),
            ).toBe(true),
          { timeout: 400 },
        ),
      ).rejects.toThrow();
    } finally {
      await page.viewport(innerWidth, innerHeight);
    }
  });

  it("shows each provider's colour once, on the bar under its name", async () => {
    view.partial = false;
    view.environments = [status("desk", { summary: summary("desk", [["claude", 60]]) })];
    await using _screen = await open(30);
    const row = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>(".usage-provider");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(row.querySelector(".usage-provider-key")).toBeNull();
    const bar = row.querySelector<HTMLElement>(".usage-share-mini")!;
    const probe = document.createElement("span");
    probe.style.color = "var(--usage-series-claude)";
    row.append(probe);
    const series = getComputedStyle(probe).color;
    probe.remove();
    expect(getComputedStyle(bar, "::after").backgroundColor).toBe(series);
  });

  it("holds the summary panel at the same height from the skeleton to the loaded page", async () => {
    using _counts = freshProviderCounts();
    view.partial = false;
    const { innerWidth, innerHeight } = window;
    await page.viewport(1280, 800);
    try {
      view.environments = [status("heightA", { isPending: true })];
      await using screen = await open(30);
      await expect.element(page.getByText("Reading usage…")).toBeVisible();
      const heightOf = () =>
        document.querySelector(".usage-summary")!.getBoundingClientRect().height;
      const waiting = heightOf();
      view.environments = [
        status("heightA", {
          summary: summary("heightA", [
            ["codex", 40],
            ["claude", 60],
          ]),
        }),
      ];
      await screen.rerender(<UsagePage />);
      await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();
      expect(heightOf()).toBe(waiting);
    } finally {
      await page.viewport(innerWidth, innerHeight);
    }
  });

  it("sizes the cold skeleton by the providers last shown for the selection, and zero when none were", async () => {
    using _counts = freshProviderCounts();
    view.partial = false;
    view.environments = [
      status("skelA", {
        summary: summary("skelA", [
          ["codex", 40],
          ["claude", 60],
        ]),
      }),
    ];
    const settled = await open(30);
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();
    await settled[Symbol.asyncDispose]();

    // The same machines on another period have no kept figures, so the skeleton shows.
    view.environments = [status("skelA", { isPending: true })];
    const cold = await open(7);
    await expect.element(page.getByText("Reading usage…")).toBeVisible();
    expect(document.querySelectorAll(".usage-summary-side .usage-provider")).toHaveLength(2);
    await cold[Symbol.asyncDispose]();

    // All providers hidden settles at zero rows, and that is what the next cold open reserves.
    const all: readonly UsageProviderKind[] = [
      "codex",
      "claude",
      "grok",
      "cursor",
      "opencode",
      "antigravity",
      "pi",
      "muse",
    ];
    view.environments = [status("skelA", { summary: summary("skelA", []) })];
    const empty = await open(30, all);
    await expect.element(page.getByText("Totals")).toBeVisible();
    await empty[Symbol.asyncDispose]();
    view.environments = [status("skelA", { isPending: true })];
    await using _coldEmpty = await open(7, all);
    await expect.element(page.getByText("Reading usage…")).toBeVisible();
    expect(document.querySelectorAll(".usage-summary-side .usage-provider")).toHaveLength(0);
  });

  it("does not size the cold skeleton by the providers another account's machines showed", async () => {
    using _counts = freshProviderCounts();
    view.partial = false;
    view.environments = [
      status("acctA", {
        summary: summary("acctA", [
          ["codex", 40],
          ["claude", 60],
        ]),
      }),
    ];
    const settled = await open(30);
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();
    await settled[Symbol.asyncDispose]();

    // Another account in the same browser profile: its machine is not acctA, so there is no count.
    view.environments = [status("acctB", { isPending: true })];
    await using _cold = await open(30);
    await expect.element(page.getByText("Reading usage…")).toBeVisible();
    expect(document.querySelectorAll(".usage-summary-side .usage-provider")).toHaveLength(4);
  });

  it("holds the sessions line at 4.5:1 or better on the light panel and the dark one", async () => {
    view.partial = false;
    view.environments = [status("desk", { summary: summary("desk", [["codex", 40]]) })];
    await using _screen = await open();
    const meta = await vi.waitFor(() => {
      const line = document.querySelector<HTMLElement>(".usage-hero-meta");
      expect(line).not.toBeNull();
      return line!;
    });
    const rgbOf = (color: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
    };
    const luminance = (rgb: readonly number[]) => {
      const [r, g, b] = rgb.map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (foreground: readonly number[], background: readonly number[]) => {
      const [light, dark] = [luminance(foreground), luminance(background)].toSorted().toReversed();
      return (light! + 0.05) / (dark! + 0.05);
    };
    for (const [theme, panel] of [
      ["light", [245, 245, 245]],
      ["dark", [14, 14, 14]],
    ] as const) {
      document.documentElement.classList.toggle("dark", theme === "dark");
      expect(ratio(rgbOf(getComputedStyle(meta).color), panel)).toBeGreaterThanOrEqual(4.5);
    }
    document.documentElement.classList.remove("dark");
  });

  it("fades the last two rems of the scroll area into the modal's edge, and labels the page like a breadcrumb", async () => {
    view.partial = false;
    view.environments = [status("desk", { summary: summary("desk", [["codex", 40]]) })];
    await using _screen = await open();
    const viewport = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        '.usage-scroll [data-slot="scroll-area-viewport"]',
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expect(getComputedStyle(viewport).maskImage).toContain("linear-gradient");
    const title = getComputedStyle(document.querySelector<HTMLElement>(".usage-title")!);
    expect(title.textTransform).toBe("none");
    expect(title.fontSize).toBe("14px");
    expect(title.fontWeight).toBe("500");
  });

  it("leads the breakdown with the active metric, and explains Unpriced with the pricing reason only", async () => {
    view.partial = false;
    const unpriced: UsageBucket = {
      ...bucket("codex", 0, "desk"),
      model: "openai/codex-model",
      unpricedRecords: 5,
      records: 5,
    };
    view.environments = [status("desk", { summary: summary("desk", [["codex", 40]], [unpriced]) })];
    saveUsagePagePreferences({ metric: "tokens", windowDays: 30 });
    await using _tokens = await render(<UsagePage />, { router: "/usage" });
    const headers = await vi.waitFor(() => {
      const found = [...document.querySelectorAll(".usage-table-head th")].map(
        (cell) => cell.textContent,
      );
      expect(found.length).toBeGreaterThan(3);
      return found;
    });
    expect(headers).toEqual(["#", "Model", "Tokens", "Share", "Cost"]);
    // One line says what the chip means for the total, and offers the way out.
    const note = document.querySelector(".usage-table-note")?.textContent ?? "";
    expect(note).toContain("1 model has no known price");
    expect(note).toContain("Set a price");

    await page.getByText("Unpriced", { exact: true }).hover();
    await expect
      .element(
        page.getByText(
          "No price is known for this model, so its cost is left out of the estimate.",
        ),
      )
      .toBeVisible();
    // A routed "openai/codex-model" and a separate "codex-model" row share a suffix and nothing else
    // known, so the page does not claim they are the same model.
    expect(document.body.textContent).not.toContain("It looks like");
  });

  it("fades both edges of the scroll area, and lights the refresh icon only while something is being read", async () => {
    view.partial = true;
    view.environments = [
      status("desk", { isPending: true, summary: summary("desk", [["codex", 40]]) }),
    ];
    saveUsagePagePreferences({ metric: "cost", windowDays: 30 });
    await using screen = await render(<UsagePage />, { router: "/usage" });
    const viewport = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        '.usage-scroll [data-slot="scroll-area-viewport"]',
      );
      expect(found).not.toBeNull();
      return found!;
    });
    const mask = getComputedStyle(viewport).maskImage;
    expect(mask.match(/transparent|rgba\(0, 0, 0, 0\)/g)?.length).toBe(2);
    expect(document.querySelector(".usage-refresh[data-refreshing]")).not.toBeNull();

    view.partial = false;
    view.environments = [status("desk", { summary: summary("desk", [["codex", 40]]) })];
    await screen.rerender(<UsagePage />);
    await vi.waitFor(() =>
      expect(document.querySelector(".usage-refresh[data-refreshing]")).toBeNull(),
    );
  });
});
