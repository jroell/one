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

  it("states each machine's state as one of the shared chips beside its name, with no dot on its icon", async () => {
    const { screen, card } = await renderScene(1200);
    await using _screen = screen;
    const chip = (name: string) =>
      card(name).querySelector<HTMLElement>("[data-settings-status]")!.dataset.settingsStatus;
    expect(chip("builder")).toBe("ready");
    expect(chip("old-box")).toBe("attention");
    expect(chip("sleeper")).toBe("connecting");
    expect(card("old-box").querySelector("[data-fleet-state]")!.textContent).toBe(
      "Client not supported",
    );
    for (const name of ["builder", "old-box", "sleeper"]) {
      // The card's only round absolute marker used to be the status dot over the icon.
      expect(card(name).querySelector("span.rounded-full.absolute"), name).toBeNull();
    }
  });

  it("never wraps a machine's name, and shows it whole at the regular width", async () => {
    const regular = await renderScene(1200);
    await using _regular = regular.screen;
    const name = (scene: typeof regular, machine: string) =>
      scene.card(machine).querySelector<HTMLElement>("[data-fleet-name]")!;
    const mac = name(regular, "Jason's MacBook Pro");
    expect(mac.getBoundingClientRect().height).toBeLessThanOrEqual(17);
    expect(mac.scrollWidth).toBeLessThanOrEqual(mac.clientWidth);
  });

  it.each([1200, 480])(
    "keeps every card's name and state on one line inside the card at a %i px canvas",
    async (canvasWidth) => {
      const { screen, card } = await renderScene(canvasWidth);
      await using _screen = screen;
      for (const machine of ["Jason's MacBook Pro", "builder", "nucbox", "old-box", "sleeper"]) {
        const button = card(machine);
        const box = button.getBoundingClientRect();
        for (const part of ["[data-fleet-name]", "[data-fleet-state]"]) {
          const element = button.querySelector<HTMLElement>(part)!;
          expect(element.getBoundingClientRect().height, `${machine} ${part}`).toBeLessThanOrEqual(
            17,
          );
          expect(element.getBoundingClientRect().bottom, `${machine} ${part}`).toBeLessThanOrEqual(
            box.bottom,
          );
        }
        // The state line is read whole; only a name may end in an ellipsis.
        const state = button.querySelector<HTMLElement>("[data-fleet-state]")!;
        expect(
          state.scrollWidth,
          `${machine}: "${state.textContent}" is clipped`,
        ).toBeLessThanOrEqual(state.clientWidth);
      }
    },
  );
});
