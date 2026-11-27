import { EnvironmentId } from "@t3tools/contracts";
import { PrimaryConnectionTarget } from "@t3tools/client-runtime/connection";
import * as DateTime from "effect/DateTime";
import { Option } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import { AppRouteModal } from "../AppRouteModal";
import { EnvironmentsMap, FleetScene } from "./EnvironmentsMap";
import { FleetDetails } from "./EnvironmentsMapDetails";
import {
  buildFleetGraph,
  fleetEnvironmentNodeId,
  fleetStacks,
  layoutFleetGraph,
  type FleetEnvironmentInput,
} from "./environmentsMap.logic";

vi.mock("../chat/GlobalVoiceInputIndicator", () => ({ GlobalVoiceInputIndicator: () => null }));
// One linked machine on the map, so a search can reach a node that is not this browser.
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: () => ({
    isReady: true,
    networkStatus: "online" as const,
    environments: [
      {
        environmentId: EnvironmentId.make("desk"),
        label: "Desk",
        displayUrl: "http://localhost:12345",
        relayManaged: false,
        entry: {
          target: new PrimaryConnectionTarget({
            environmentId: EnvironmentId.make("desk"),
            label: "Desk",
            httpBaseUrl: "http://localhost:12345",
            wsBaseUrl: "ws://localhost:12345/ws",
          }),
          profile: Option.none(),
          enabled: true,
        },
        connection: { phase: "connected", error: null, traceId: null },
        refusedRouteIds: [],
        serverConfig: null,
      },
    ],
    presentationById: new Map(),
  }),
}));

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

const linkedAt = DateTime.makeUnsafe("2026-11-19T12:00:00.000Z");
const hub: FleetEnvironmentInput = {
  environmentId: EnvironmentId.make("hub"),
  label: "hub",
  machine: "server",
  phase: "connected",
  enabled: true,
  routes: [],
  activeRouteId: null,
  refusedRouteIds: [],
  offersLinks: true,
  canWriteAccess: true,
  hasLinkAddress: true,
  outgoing: {
    state: "loaded",
    links: Array.from({ length: 10 }, (_, index) => ({
      environmentId: EnvironmentId.make(`vm-${index + 1}`),
      label: `vm-${index + 1}`,
      urls: [],
      access: "approval-required",
      linkedAt,
      expiresAt: DateTime.makeUnsafe("2027-01-01T00:00:00.000Z"),
      lastReachedAt: null,
      lastError: null,
      status: "reachable",
    })),
  },
};

const renderSettingsMap = () =>
  render(
    <AppRouteModal label="Settings">
      <EnvironmentsMap
        onAddEnvironment={() => {}}
        renderSavedEnvironment={() => null}
        renderConnectMachine={() => null}
      />
    </AppRouteModal>,
    { router: "/settings/connections" },
  );

describe("EnvironmentsMap", () => {
  it("clears the selection on Esc before Settings closes", async () => {
    await using _screen = await renderSettingsMap();
    const settings = page.getByRole("dialog", { name: "Settings" });
    const browser = page.getByRole("button", { name: "This browser", exact: true });

    await expect.element(settings).toHaveFocus();
    await browser.click();
    await expect.element(browser).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Escape}");

    await expect.element(browser).toHaveAttribute("aria-pressed", "false");
    // The close would render in the same commit that cleared the selection.
    expect(settings.element()).toHaveAttribute("data-open");

    await userEvent.keyboard("{Escape}");
    await expect.element(settings).not.toBeInTheDocument();
  });

  it("clears the selection on Esc when a click does not focus the machine", async () => {
    await using _screen = await renderSettingsMap();
    // Safari leaves focus where it was when a button is clicked.
    const keepFocus = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("mousedown", keepFocus, true);
    using _keepFocus = {
      [Symbol.dispose]: () => document.removeEventListener("mousedown", keepFocus, true),
    };
    const settings = page.getByRole("dialog", { name: "Settings" });
    const browser = page.getByRole("button", { name: "This browser", exact: true });

    await expect.element(settings).toHaveFocus();
    await browser.click();
    await expect.element(browser).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Escape}");

    await expect.element(browser).toHaveAttribute("aria-pressed", "false");
    expect(settings.element()).toHaveAttribute("data-open");
  });

  it("clears the selection on Esc from the details before Settings closes", async () => {
    await using _screen = await renderSettingsMap();
    const settings = page.getByRole("dialog", { name: "Settings" });
    const browser = page.getByRole("button", { name: "This browser", exact: true });
    const details = page.getByRole("group", { name: "Details" });

    await expect.element(settings).toHaveFocus();
    await browser.click();
    await expect.element(browser).toHaveAttribute("aria-pressed", "true");
    // Choosing a machine or link inside the details leaves focus on the panel.
    (details.element() as HTMLElement).focus();
    await userEvent.keyboard("{Escape}");

    await expect.element(browser).toHaveAttribute("aria-pressed", "false");
    expect(settings.element()).toHaveAttribute("data-open");

    await userEvent.keyboard("{Escape}");
    await expect.element(settings).not.toBeInTheDocument();
  });

  it("clears a stack's filter on Esc before Settings closes", async () => {
    const graph = buildFleetGraph({
      clientLabel: "This browser",
      environments: [hub],
      connectMachines: [],
      now: linkedAt,
    });
    const [stack] = fleetStacks(graph, new Set());
    const onSelect = vi.fn();
    await using _screen = await render(
      <AppRouteModal label="Settings">
        <FleetDetails
          graph={graph}
          stacks={[stack!]}
          environments={[]}
          connectProblem={null}
          selection={{ kind: "stack", id: stack!.id }}
          found={null}
          onSelect={onSelect}
          onLinkFrom={() => {}}
          onLinkBack={() => {}}
          onToggleStack={() => {}}
          renderSavedEnvironment={() => null}
          renderConnectMachine={() => null}
          onAddEnvironment={() => {}}
        />
      </AppRouteModal>,
      { router: "/settings/connections" },
    );
    const settings = page.getByRole("dialog", { name: "Settings" });
    const filter = page.getByRole("searchbox", { name: "Filter these machines by name" });

    await filter.fill("vm-1");
    await expect.element(page.getByRole("status")).toHaveTextContent("2 of 10");
    await userEvent.keyboard("{Escape}");

    await expect.element(filter).toHaveValue("");
    expect(settings.element()).toHaveAttribute("data-open");
    expect(onSelect).not.toHaveBeenCalled();

    await filter.fill("vm-1");
    // An Escape that cancels an IME composition (Safari reports keyCode 229) belongs to the IME.
    for (const composition of [
      { isComposing: true, keyCode: 27 },
      { isComposing: false, keyCode: 229 },
    ]) {
      await act(() => {
        filter
          .element()
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", ...composition, bubbles: true }),
          );
      });
      await expect.element(filter).toHaveValue("vm-1");
      expect(settings.element()).toHaveAttribute("data-open");
    }

    await userEvent.keyboard("{Escape}");
    await expect.element(filter).toHaveValue("");
    await userEvent.keyboard("{Escape}");
    await expect.element(settings).not.toBeInTheDocument();
  });

  it("keeps the map search on Escape and Enter that belong to an IME", async () => {
    await using _screen = await renderSettingsMap();
    const settings = page.getByRole("dialog", { name: "Settings" });
    const desk = page.getByRole("button", { name: /^Desk/ });
    const mapSearch = page.getByRole("searchbox", { name: "Find a machine on the map" });

    await expect.element(mapSearch).toHaveAttribute("type", "text");
    await mapSearch.fill("Desk");

    // An Escape that cancels an IME composition belongs to the IME, not to the search.
    for (const composition of [
      { isComposing: true, keyCode: 27 },
      { isComposing: false, keyCode: 229 },
    ]) {
      await act(() => {
        mapSearch
          .element()
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", ...composition, bubbles: true }),
          );
      });
      await expect.element(mapSearch).toHaveValue("Desk");
      expect(settings.element()).toHaveAttribute("data-open");
    }

    // An Enter that confirms an IME composition belongs to the IME too.
    for (const composition of [
      { isComposing: true, keyCode: 13 },
      { isComposing: false, keyCode: 229 },
    ]) {
      await act(() => {
        mapSearch.element().dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            ...composition,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await expect.element(desk).toHaveAttribute("aria-pressed", "false");
    }

    // The same Enter outside a composition still jumps to the first match.
    await act(() => {
      mapSearch.element().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          isComposing: false,
          keyCode: 13,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect.element(desk).toHaveAttribute("aria-pressed", "true");

    // Jumping to the match moved focus to the node; take it back for the Escape below.
    await mapSearch.click();
    await userEvent.keyboard("{Escape}");
    await expect.element(mapSearch).toHaveValue("");
    expect(settings.element()).toHaveAttribute("data-open");

    await userEvent.keyboard("{Escape}");
    await expect.element(settings).not.toBeInTheDocument();
  });
});
