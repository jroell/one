import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { status, summary } from "../components/usage/usageFixtures";
import { type EnvironmentUsageStatus, useUsage } from "./usage";

const live = vi.hoisted(() => ({ environments: [] as unknown[] }));

// Only the atom read is replaced; the hook itself, with its carried figures, is the real one.
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => live.environments) as never,
}));

const window = {
  sinceDay: "2026-08-01",
  untilDay: "2026-08-31",
  timeZone: "UTC",
  resolution: "day",
} as never;

function Probe() {
  const { shown } = useUsage(window, null);
  return (
    <output aria-label="figures">{shown === null ? "none" : `$${shown.merged.costUsd}`}</output>
  );
}

const answered = (id: string, provider: "codex" | "claude", cost: number): EnvironmentUsageStatus =>
  status(id, { summary: summary(id, [[provider, cost]]) });

describe("useUsage carried figures", () => {
  it("drops the aggregate of a machine whose grant is revoked in place while the other has no answer yet", async () => {
    live.environments = [answered("keepA", "codex", 40), answered("keepB", "claude", 60)];
    await using screen = await render(<Probe />, { router: false });
    await expect.element(screen.getByLabelText("figures")).toHaveTextContent("$100");

    // A loses its diagnostics grant and B's response for the current query is still held. The
    // selection and the hidden set are the same objects as before, so only the contributors differ.
    live.environments = [
      status("keepA", { canReadDiagnostics: false }),
      status("keepB", { isPending: true }),
    ];
    await screen.rerender(<Probe />);
    await expect.element(screen.getByLabelText("figures")).toHaveTextContent("none");
  });

  it("keeps carrying the figures while the same machines are only waiting on a refresh", async () => {
    live.environments = [answered("sameA", "codex", 40), answered("sameB", "claude", 60)];
    await using screen = await render(<Probe />, { router: false });
    await expect.element(screen.getByLabelText("figures")).toHaveTextContent("$100");

    live.environments = [
      status("sameA", { isPending: true }),
      status("sameB", { isPending: true }),
    ];
    await screen.rerender(<Probe />);
    await expect.element(screen.getByLabelText("figures")).toHaveTextContent("$100");
  });
});
