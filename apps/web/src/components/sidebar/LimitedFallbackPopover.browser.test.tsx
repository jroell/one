import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { appAtomRegistry } from "../../rpc/atomRegistry";

const setup = vi.hoisted(() => ({
  settings: null as unknown,
  providers: new Map<string, unknown>(),
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
  useEnvironmentScope: (() => true) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => setup.update) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentProviders: (() => setup.providers) as never,
}));

import { LimitedFallbackPopover } from "./LimitedFallbackPopover";

const environmentId = EnvironmentId.make("desk");
const checkedAt = "2026-10-25T16:00:00.000Z";
// Far enough ahead that the window is still open whenever the test runs.
const inAWeek = "2099-01-01T00:00:00.000Z";

const provider = (instanceId: string, driver: string, usedPercent: number): ServerProvider =>
  ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [{ slug: `${driver}-model`, name: driver, isCustom: false }],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [{ id: "weekly", label: "Weekly", kind: "weekly", usedPercent, resetsAt: inAWeek }],
    },
  }) as unknown as ServerProvider;

function chip(instanceId: string, onRowClick: () => void) {
  return render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <div role="presentation" onClick={onRowClick}>
        <LimitedFallbackPopover
          environmentId={environmentId}
          instanceId={ProviderInstanceId.make(instanceId)}
        >
          <span>Limited</span>
        </LimitedFallbackPopover>
      </div>
    </RegistryContext.Provider>,
  );
}

describe("the Limited status word of a thread", () => {
  it("opens the fallback action for the provider that is out, without opening the thread", async () => {
    setup.providers = new Map([
      [environmentId, [provider("codex", "codex", 100), provider("claude", "claudeAgent", 20)]],
    ]);
    setup.update.mockReset().mockResolvedValue({ _tag: "Success" });
    const openThread = vi.fn();
    await using _screen = await chip("codex", openThread);

    await userEvent.click(page.getByRole("button", { name: "Usage limit: what to do" }));
    await userEvent.click(page.getByRole("button", { name: /^Use .* until .* resets$/ }));
    await vi.waitFor(() =>
      expect(setup.update).toHaveBeenCalledWith({
        environmentId,
        input: {
          patch: { fallbackModelSelection: { instanceId: "claude", model: "claudeAgent-model" } },
        },
      }),
    );
    expect(openThread).not.toHaveBeenCalled();
  });

  it("stays plain text when the thread's provider is not out of usage", async () => {
    setup.providers = new Map([[environmentId, [provider("codex", "codex", 10)]]]);
    await using screen = await chip("codex", vi.fn());
    await expect.element(screen.getByText("Limited")).toBeVisible();
    expect(document.querySelector('button[aria-label="Usage limit: what to do"]')).toBeNull();
  });
});
