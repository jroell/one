import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { UsageOverviewHeadline } from "./UsageOverviewHeadline";

describe("UsageOverviewHeadline", () => {
  it.each([
    ["tokens", 30, "Codex did 57% of 90.8B tokens in the last 30 days."],
    ["tokens", 1, "Codex did 57% of 90.8B tokens in the past 24 hours."],
    ["cost", 7, "Codex was 57% of 90.8B in the last 7 days."],
    ["cost", 1, "Codex was 57% of 90.8B in the past 24 hours."],
  ] as const)("a %s tab over %i days reads: %s", async (metric, days, sentence) => {
    await using screen = await render(
      <UsageOverviewHeadline
        metric={metric}
        provider="Codex"
        share="57%"
        total="90.8B"
        days={days}
      />,
      { router: false },
    );
    await expect.element(screen.getByRole("heading", { name: sentence })).toBeVisible();
  });

  it("keeps the sentence at full strength while partial and says Updating instead, then says nothing", async () => {
    const props = {
      metric: "tokens",
      provider: "Codex",
      share: "57%",
      total: "90.8B",
      days: 30,
    } as const;
    await using screen = await render(<UsageOverviewHeadline {...props} loading />, {
      router: false,
    });
    await expect.element(screen.getByText("Updating…")).toBeVisible();
    // The numbers stay readable: no dimming, whatever is still loading.
    expect(getComputedStyle(screen.getByRole("heading").element()).opacity).toBe("1");

    await screen.rerender(<UsageOverviewHeadline {...props} />);
    await expect.element(screen.getByText("Updating…")).not.toBeInTheDocument();
  });
});
