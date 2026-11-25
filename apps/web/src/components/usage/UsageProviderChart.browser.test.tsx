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
});
