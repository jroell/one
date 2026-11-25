import { EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { FleetScene } from "./EnvironmentsMap";
import {
  buildFleetGraph,
  fleetEnvironmentNodeId,
  fleetStacks,
  layoutFleetGraph,
  type FleetEnvironmentInput,
} from "./environmentsMap.logic";

const input = (name: string, overrides: Partial<FleetEnvironmentInput>): FleetEnvironmentInput => ({
  environmentId: EnvironmentId.make(name),
  label: name,
  machine: "server",
  phase: "connected",
  enabled: true,
  routes: [{ id: "tailnet", kind: "tailnet" }],
  activeRouteId: "tailnet",
  refusedRouteIds: [],
  offersLinks: true,
  canWriteAccess: true,
  hasLinkAddress: true,
  outgoing: { state: "off" },
  ...overrides,
});

const environments = [
  input("Jason's MacBook Pro", {
    routes: [{ id: "lo", kind: "loopback" }],
    activeRouteId: "lo",
  }),
  input("builder", { outgoing: { state: "error", message: "boom" } }),
  input("nucbox", { outgoing: { state: "unknown" } }),
  input("old-box", { phase: "unsupported" }),
  input("sleeper", { phase: "reconnecting" }),
];

async function renderScene(canvasWidth: number) {
  const graph = buildFleetGraph({
    clientLabel: "This browser",
    environments,
    connectMachines: [],
    now: DateTime.makeUnsafe("2026-11-25T12:00:00.000Z"),
  });
  const stacks = fleetStacks(graph, new Set());
  const layout = layoutFleetGraph(graph, stacks, canvasWidth);
  const screen = await render(
    <div
      data-fleet-scene=""
      style={{ position: "relative", width: layout.width, height: layout.height }}
    >
      <FleetScene
        graph={graph}
        stacks={stacks}
        layout={layout}
        environments={[]}
        selection={null}
        selected={new Set()}
        matches={null}
        onSelect={vi.fn()}
        onTick={vi.fn()}
        onLink={vi.fn()}
        onToggleStack={vi.fn()}
        onReveal={vi.fn()}
      />
    </div>,
    { router: false },
  );
  const card = (name: string) =>
    screen.container.querySelector<HTMLElement>(
      `[data-fleet-node="${fleetEnvironmentNodeId(EnvironmentId.make(name))}"]`,
    )!;
  return { screen, card };
}

describe("environments map cards", () => {
  it("names this device with a badge inside its own card and on no other", async () => {
    const { screen, card } = await renderScene(1200);
    await using _screen = screen;
    const badge = card("Jason's MacBook Pro").querySelector("[data-fleet-this-device]");
    expect(badge?.textContent).toBe("This device");
    for (const other of ["builder", "nucbox", "old-box", "sleeper"]) {
      expect(card(other).querySelector("[data-fleet-this-device]"), other).toBeNull();
    }
  });

  it.each([1200, 480])(
    "shows every card's state text in full and inside the card at a %i px canvas",
    async (canvasWidth) => {
      const { screen, card } = await renderScene(canvasWidth);
      await using _screen = screen;
      for (const name of ["Jason's MacBook Pro", "builder", "nucbox", "old-box", "sleeper"]) {
        const button = card(name);
        const state = button.querySelector<HTMLElement>("[data-fleet-state]")!;
        expect(state.textContent, name).not.toBe("");
        expect(
          state.scrollHeight,
          `${name}: "${state.textContent}" is clipped`,
        ).toBeLessThanOrEqual(state.clientHeight);
        const box = button.getBoundingClientRect();
        const text = state.getBoundingClientRect();
        expect(text.bottom, name).toBeLessThanOrEqual(box.bottom);
        const top = button.querySelector<HTMLElement>(
          "[data-fleet-this-device], span.line-clamp-2",
        )!;
        expect(top.getBoundingClientRect().top, name).toBeGreaterThanOrEqual(box.top);
      }
    },
  );
});
