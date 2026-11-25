import {
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type UsageBucket,
  type UsageDay,
  type UsageProviderKind,
  type UsageSummary,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import type { EnvironmentUsageStatus } from "../../state/usage";
import { UsagePage } from "./UsagePage";
import { saveUsagePagePreferences } from "./usagePagePreferences";

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

function bucket(provider: UsageProviderKind, costUsd: number, host: string): UsageBucket {
  return {
    day: "2026-08-07" as UsageDay,
    provider,
    model: `${provider}-model`,
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 1000,
      cacheCreationTokens: 10,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    costUsd,
    cacheSavingsUsd: 1,
    costSource: "modelPriced",
    records: 5,
    unpricedRecords: 0,
    sessions: 1,
    sourcePath: `/${host}/${provider}`,
  };
}

function summary(
  host: string,
  providers: readonly (readonly [UsageProviderKind, number])[],
): UsageSummary {
  return {
    contractVersion: USAGE_CONTRACT_VERSION,
    readAt: "2026-08-07T00:00:00.000Z",
    timeZone: "UTC",
    sinceDay: "2026-08-01" as UsageDay,
    untilDay: "2026-08-31" as UsageDay,
    buckets: providers.map(([provider, cost]) => bucket(provider, cost, host)),
    sources: providers.map(([provider]) => ({
      fingerprint: {
        hostId: host,
        provider,
        resolvedHomePath: `/${host}/${provider}`,
        volumeId: `vol-${host}`,
      },
      status: "ok" as const,
      scannedFiles: 1,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions: 1,
      message: null,
    })),
    pricing: { status: "fresh", source: "litellm", fetchedAt: null, knownModels: 10 },
    scanDurationMs: 1,
  } as UsageSummary;
}

function status(
  id: string,
  overrides: Partial<EnvironmentUsageStatus> = {},
): EnvironmentUsageStatus {
  return {
    environmentId: id as EnvironmentId,
    label: id,
    isPending: false,
    canReadDiagnostics: true,
    isConnected: true,
    error: null,
    summary: null,
    ...overrides,
  };
}

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

  it("does not replay figures of a machine that lost access when the reopened page is still waiting", async () => {
    view.partial = false;
    view.environments = [
      status("reopenA", { summary: summary("reopenA", [["codex", 40]]) }),
      status("reopenB", { summary: summary("reopenB", [["claude", 60]]) }),
    ];
    const first = await open();
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();
    await first[Symbol.asyncDispose]();

    // A has lost diagnostics access and B's summary is still pending.
    view.environments = [
      status("reopenA", { canReadDiagnostics: false }),
      status("reopenB", { isPending: true }),
    ];
    await using _second = await render(<UsagePage />, { router: "/usage" });
    await expect.element(page.getByText("Reading usage…")).toBeVisible();
    expect(document.body.textContent).not.toContain("$100.00");
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
});
