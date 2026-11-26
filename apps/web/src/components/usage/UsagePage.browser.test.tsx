import type { UsageBucket, UsageProviderKind } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import type { EnvironmentUsageStatus } from "../../state/usage";
import { UsagePage } from "./UsagePage";
import { saveUsagePagePreferences } from "./usagePagePreferences";
import { bucket, status, summary } from "./usageFixtures";

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

  it("sizes the cold skeleton by the providers last shown for the selection, and zero when none were", async () => {
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
    expect(document.querySelector(".usage-table-note")?.textContent).toContain("Unpriced");

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
