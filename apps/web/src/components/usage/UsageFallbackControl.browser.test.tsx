import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { act, render } from "../../../test/render";
import { appAtomRegistry } from "../../rpc/atomRegistry";

// Only the transport is replaced: the settings value, the write and the permission. The control,
// the page code that places it and the model resolution the setting feeds are the real ones.
const setup = vi.hoisted(() => ({
  settings: null as unknown,
  canWrite: true,
  update: vi.fn(),
}));

vi.mock(import("../../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const actual = await original();
  setup.settings = Atom.make({ fallbackModelSelection: null }).pipe(Atom.keepAlive);
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      settingsValueAtom: (() => setup.settings) as never,
      updateSettings: "updateSettings" as never,
    },
  };
});
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => setup.canWrite) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => setup.update) as never,
}));

import { UsageLimitsPooled } from "./UsageLimitsPooled";

const checkedAt = "2026-10-25T16:00:00.000Z";
const now = Date.parse(checkedAt);
const environmentId = EnvironmentId.make("desk");

function provider(
  instanceId: string,
  driver: string,
  displayName: string,
  patch: Partial<ServerProvider> = {},
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    displayName,
    enabled: true,
    installed: true,
    version: "1",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [{ slug: `${driver}-model`, name: displayName, isCustom: false }],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [
        {
          id: "weekly",
          label: "Weekly",
          kind: "weekly",
          usedPercent: 40,
          resetsAt: "2026-10-30T16:45:00.000Z",
        },
      ],
    },
    ...patch,
  } as ServerProvider;
}

const outCodex = () =>
  provider("codex", "codex", "Codex", {
    usageLimits: {
      checkedAt,
      windows: [
        {
          id: "weekly",
          label: "Weekly",
          kind: "weekly",
          usedPercent: 100,
          resetsAt: "2026-10-30T16:45:00.000Z",
        },
      ],
    },
  });

async function open(providers: readonly ServerProvider[], fallback: unknown = null) {
  setup.update.mockReset();
  setup.canWrite = true;
  appAtomRegistry.set(setup.settings as never, { fallbackModelSelection: fallback });
  setup.update.mockImplementation(
    async (request: { input: { patch: { fallbackModelSelection: unknown } } }) => {
      appAtomRegistry.set(setup.settings as never, {
        fallbackModelSelection: request.input.patch.fallbackModelSelection,
      });
      return { _tag: "Success" };
    },
  );
  const presentations = new Map([
    [environmentId, { entry: { target: { label: "Desk" } }, serverConfig: { providers } }],
  ]);
  return render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <UsageLimitsPooled presentations={presentations} now={now} />
    </RegistryContext.Provider>,
  );
}

describe("the fallback beside a provider that is out of usage", () => {
  it("sets the fallback model, says what it did with the reset date, and Undo clears it", async () => {
    const claude = provider("claude", "claudeAgent", "Claude");
    await using _screen = await open([outCodex(), claude]);

    await userEvent.click(page.getByRole("button", { name: "Use Claude until Codex resets" }));
    const selection = { instanceId: "claude", model: "claudeAgent-model" };
    await vi.waitFor(() =>
      expect(setup.update).toHaveBeenCalledWith({
        environmentId,
        input: { patch: { fallbackModelSelection: selection } },
      }),
    );
    await expect
      .element(page.getByText(/New threads use Claude until Codex resets on /))
      .toBeVisible();
    // The setting is real: new-thread model resolution now picks the fallback while Codex is out.
    expect(
      resolveNewThreadModelSelection({
        defaultSelection: { instanceId: ProviderInstanceId.make("codex"), model: "codex-model" },
        fallbackSelection: (
          appAtomRegistry.get(setup.settings as never) as { fallbackModelSelection: never }
        ).fallbackModelSelection,
        providers: [outCodex(), claude],
        now,
      }).selection,
    ).toMatchObject(selection);

    await userEvent.click(page.getByRole("button", { name: "Undo" }));
    await vi.waitFor(() =>
      expect(setup.update).toHaveBeenLastCalledWith({
        environmentId,
        input: { patch: { fallbackModelSelection: null } },
      }),
    );
    expect(
      (appAtomRegistry.get(setup.settings as never) as { fallbackModelSelection: unknown })
        .fallbackModelSelection,
    ).toBeNull();
  });

  it("says a fallback is already set instead of offering one", async () => {
    const claude = provider("claude", "claudeAgent", "Claude");
    await using _screen = await open([outCodex(), claude], {
      instanceId: "claude",
      model: "claudeAgent-model",
    });
    await expect
      .element(page.getByText("New threads use Claude while Codex is out of usage."))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("until Codex resets");
  });

  it("offers no button, and says so, when no other provider is signed in", async () => {
    await using _screen = await open([outCodex()]);
    await expect
      .element(page.getByText("No other provider is signed in on this machine."))
      .toBeVisible();
    expect(
      page.getByRole("button", { name: /^Use .* until Codex resets$/ }).elements(),
    ).toHaveLength(0);
  });

  it("offers no button, and says so, when the other providers are out of usage too", async () => {
    const claudeOut = provider("claude", "claudeAgent", "Claude", {
      usageLimits: outCodex().usageLimits as never,
    });
    await using _screen = await open([outCodex(), claudeOut]);
    await expect
      .element(page.getByText("No other signed-in provider has usage left."))
      .toBeVisible();
    expect(document.querySelectorAll(".usage-fallback button")).toHaveLength(0);
  });

  it("offers no button without permission to change settings", async () => {
    const claude = provider("claude", "claudeAgent", "Claude");
    setup.canWrite = false;
    const presentations = new Map([
      [
        environmentId,
        { entry: { target: { label: "Desk" } }, serverConfig: { providers: [outCodex(), claude] } },
      ],
    ]);
    await using screen = await render(
      <RegistryContext.Provider value={appAtomRegistry}>
        <UsageLimitsPooled presentations={presentations} now={now} />
      </RegistryContext.Provider>,
    );
    await expect.element(screen.getByText("Weekly").first()).toBeVisible();
    expect(document.querySelectorAll(".usage-fallback button")).toHaveLength(0);
    await act(async () => {});
  });

  it("shows nothing for a provider that is not out", async () => {
    const claude = provider("claude", "claudeAgent", "Claude");
    await using _screen = await open([provider("codex", "codex", "Codex"), claude]);
    await expect.element(page.getByText("Weekly").first()).toBeVisible();
    expect(document.querySelector(".usage-fallback")).toBeNull();
  });
});
