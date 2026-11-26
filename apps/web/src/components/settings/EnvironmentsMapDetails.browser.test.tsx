import { EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { FleetDetails } from "./EnvironmentsMapDetails";
import {
  buildFleetGraph,
  fleetEnvironmentNodeId,
  fleetStacks,
  type FleetEnvironmentInput,
} from "./environmentsMap.logic";

const state = vi.hoisted(() => ({
  updates: [] as Array<{ environmentId: string; patch: object }>,
}));

vi.mock(import("~/hooks/useSettings"), async (original) => ({
  ...(await original()),
  useUpdateEnvironmentSettings: ((environmentId: string) => (patch: object) => {
    state.updates.push({ environmentId, patch });
    return Promise.resolve();
  }) as never,
}));

const builder: FleetEnvironmentInput = {
  environmentId: EnvironmentId.make("builder"),
  label: "builder",
  machine: "server",
  phase: "connected",
  enabled: true,
  routes: [{ id: "tailnet", kind: "tailnet" }],
  activeRouteId: "tailnet",
  refusedRouteIds: [],
  offersLinks: false,
  canWriteAccess: true,
  hasLinkAddress: true,
  outgoing: { state: "off" },
};

describe("a machine whose linking is off", () => {
  it("says so in words and turns linking on from the details, instead of pointing at Labs", async () => {
    const graph = buildFleetGraph({
      clientLabel: "This browser",
      environments: [builder],
      connectMachines: [],
      now: DateTime.makeUnsafe("2026-11-26T12:00:00.000Z"),
    });
    await using _screen = await render(
      <FleetDetails
        graph={graph}
        stacks={fleetStacks(graph, new Set())}
        environments={[]}
        connectProblem={null}
        selection={{ kind: "node", id: fleetEnvironmentNodeId(builder.environmentId) }}
        found={null}
        onSelect={vi.fn()}
        onLinkFrom={vi.fn()}
        onLinkBack={vi.fn()}
        onToggleStack={vi.fn()}
        renderSavedEnvironment={() => null}
        renderConnectMachine={() => null}
        onAddEnvironment={vi.fn()}
      />,
      { router: false },
    );
    await expect
      .element(page.getByText("Linking is off on builder, so it cannot link to other machines."))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("Labs");
    await userEvent.click(page.getByRole("button", { name: "Turn on linking" }));
    expect(state.updates).toEqual([
      { environmentId: "builder", patch: { linkedEnvironmentsEnabled: true } },
    ]);
  });
});
