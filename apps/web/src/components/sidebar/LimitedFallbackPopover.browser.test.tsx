import { RegistryContext } from "@effect/atom-react";
import { minuteTick } from "@t3tools/client-runtime/clock";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { appAtomRegistry } from "../../rpc/atomRegistry";

const setup = vi.hoisted(() => ({
  providers: new Map<string, unknown>(),
  update: vi.fn(),
}));
const settings = Atom.make(DEFAULT_SERVER_SETTINGS).pipe(Atom.keepAlive);

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      settingsValueAtom: () => settings,
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
const resetAt = "2026-10-25T18:00:00.000Z";

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
      windows: [{ id: "weekly", label: "Weekly", kind: "weekly", usedPercent, resetsAt: resetAt }],
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
  it("opens the fallback action from New York with two hours left before the reset", async () => {
    const session = cdp();
    await session.send("Emulation.setTimezoneOverride", { timezoneId: "America/New_York" });
    await using _zone = {
      async [Symbol.asyncDispose]() {
        await session.send("Emulation.setTimezoneOverride", { timezoneId: "" });
      },
    };
    using _minute = vi.spyOn(minuteTick, "getSnapshot").mockReturnValue(checkedAt.slice(0, 16));
    setup.providers = new Map([
      [
        environmentId,
        [provider("codex", "codex", 100), provider("claudeAgent", "claudeAgent", 20)],
      ],
    ]);
    appAtomRegistry.set(settings, DEFAULT_SERVER_SETTINGS);
    setup.update
      .mockReset()
      .mockImplementation(
        async (request: {
          input: { patch: Pick<typeof DEFAULT_SERVER_SETTINGS, "fallbackModelSelection"> };
        }) => {
          appAtomRegistry.set(settings, { ...DEFAULT_SERVER_SETTINGS, ...request.input.patch });
          return { _tag: "Success" };
        },
      );
    const openThread = vi.fn();
    await using _screen = await chip("codex", openThread);

    const trigger = page.getByRole("button", { name: "Usage limit: what to do" });
    expect(trigger.elements()).toHaveLength(1);
    await userEvent.click(trigger);
    await userEvent.click(page.getByRole("button", { name: "Use Claude until Codex resets" }));
    await vi.waitFor(() =>
      expect(appAtomRegistry.get(settings).fallbackModelSelection).toEqual({
        instanceId: "claudeAgent",
        model: "claudeAgent-model",
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
