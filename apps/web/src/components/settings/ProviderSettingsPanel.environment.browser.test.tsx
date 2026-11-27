import { RegistryContext } from "@effect/atom-react";
import {
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderAuthState,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import { AsyncResult, type Atom } from "effect/reactivity";
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, fakeTimers, render } from "../../../test/render";

const state = vi.hoisted(() => ({
  providers: null as unknown as Atom.Writable<ReadonlyArray<ServerProvider>>,
  providerAuthQuery: null as unknown,
  providerAuth: null as ProviderAuthState | null,
  settings: null as unknown as UnifiedSettings,
  canManageProviders: true,
  canWriteSettings: true,
  searchTargetId: null as string | null,
  readEnvironmentIds: [] as string[],
  updateEnvironmentIds: [] as string[],
  mutationEnvironmentIds: [] as string[],
  refresh: vi.fn(),
  updateProvider: vi.fn(),
  uninstall: vi.fn(),
  acceptUrlAuth: vi.fn(),
  updateSettings: vi.fn(),
  updateModelPreferences: vi.fn(),
  toggleFavorite: vi.fn(),
  mutateProviderInstance: vi.fn(),
  confirm: vi.fn<() => Promise<boolean>>(),
}));

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const providers = Atom.make<ReadonlyArray<ServerProvider>>([]).pipe(Atom.keepAlive);
  state.providers = providers;
  const config = Atom.make(null);
  const providerAuth = Atom.make(null);
  state.providerAuthQuery = providerAuth;
  const commandLabels = {
    refreshProviders: "refresh",
    updateProvider: "update",
    uninstallAcpRegistryManagedBinary: "uninstall",
    acceptAcpRegistryUrlAuth: "accept-url-auth",
  } as const;
  const labelled = Object.fromEntries(
    Object.entries(commandLabels).map(([key, label]) => [
      key,
      { ...actual.serverEnvironment[key as keyof typeof commandLabels], label },
    ]),
  );
  return {
    ...actual,
    providersIgnoringCheckedAtAtom: (() => providers) as never,
    serverEnvironment: {
      ...actual.serverEnvironment,
      ...labelled,
      configValueAtom: (() => config) as never,
      providerAuthState: (() => providerAuth) as never,
      providersValueAtom: (() => providers) as never,
    } as never,
  };
});
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: { label?: string }) =>
    ({
      refresh: state.refresh,
      update: state.updateProvider,
      uninstall: state.uninstall,
      "accept-url-auth": state.acceptUrlAuth,
    })[command.label ?? ""] ?? vi.fn()) as never,
}));
vi.mock(import("~/localApi"), async (original) => {
  const api = { dialogs: { confirm: state.confirm } };
  return {
    ...(await original()),
    readLocalApi: (() => api) as never,
    ensureLocalApi: (() => api) as never,
  };
});
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((query: unknown) => ({
    data: query === state.providerAuthQuery ? state.providerAuth : null,
    error: null,
    isPending: false,
    refresh: vi.fn(),
  })) as never,
}));
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: ((environmentId: string) => {
    state.readEnvironmentIds.push(environmentId);
    return state.settings;
  }) as never,
  useUpdateEnvironmentSettings: ((environmentId: string) => {
    state.updateEnvironmentIds.push(environmentId);
    return state.updateSettings;
  }) as never,
  useUpdateEnvironmentModelPreferences: (() => state.updateModelPreferences) as never,
  useToggleEnvironmentModelFavorite: (() => state.toggleFavorite) as never,
  usePersistEnvironmentProviderInstanceMutation: ((environmentId: string) => {
    state.mutationEnvironmentIds.push(environmentId);
    return state.mutateProviderInstance;
  }) as never,
}));
vi.mock(import("../../state/session"), async (original) => {
  const scope = (environmentId: string, requested: string) =>
    environmentId === "remote-device" &&
    (requested === "providers:manage"
      ? state.canManageProviders
      : requested === "settings:write"
        ? state.canWriteSettings
        : requested === "orchestration:read");
  return {
    ...(await original()),
    useEnvironmentScope: scope as never,
    readEnvironmentScope: scope as never,
  };
});
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => []) as never,
}));
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  useSettingsSearchTargetId: () => state.searchTargetId,
  SettingsRow: (({
    id,
    title,
    description,
    status,
    control,
    children,
  }: {
    id?: string;
    title: ReactNode;
    description?: ReactNode;
    status?: ReactNode;
    control?: ReactNode;
    children?: ReactNode;
  }) => (
    <div id={id}>
      <h4>{title}</h4>
      {description}
      {status}
      {control}
      {children}
    </div>
  )) as never,
}));
vi.mock(import("./UsageProviderSettings"), async (original) => ({
  ...(await original()),
  UsageProviderSettings: (() => null) as never,
}));
vi.mock(import("../ProviderUpdatesAction"), async (original) => ({
  ...(await original()),
  ProviderUpdatesAction: (() => null) as never,
}));

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { EnvironmentProviderSettings } from "./ProviderSettingsPanel";
import { UNREPORTED_PROVIDER_MS } from "./ProviderInstanceCard";
import { SettingsBreadcrumb } from "./SettingsBreadcrumb";
import { SettingsPageHeader } from "./SettingsPageHeader";
import { useProviderInstanceRoute } from "./useProviderInstanceRoute";
import { Route as ProvidersRoute } from "../../routes/_chat.settings.providers";

const environmentId = EnvironmentId.make("remote-device");
const codexId = ProviderInstanceId.make("codex");
const customId = ProviderInstanceId.make("codex_work");

function provider(): ServerProvider {
  return {
    instanceId: codexId,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-24T12:00:00.000Z",
    models: [{ slug: "chosen", name: "Chosen", isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
    versionAdvisory: {
      status: "behind_latest",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      updateCommand: "pnpm add -g @openai/codex@latest",
      canUpdate: true,
      checkedAt: "2026-07-24T12:00:00.000Z",
      message: "Update available.",
    },
  };
}

const setProviders = (providers: ReadonlyArray<ServerProvider>) =>
  act(async () => appAtomRegistry.set(state.providers, providers));

function panel(options?: {
  readonly readOnly?: boolean;
  readonly targetInstanceId?: ProviderInstanceId;
}) {
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <div className="@container/providers">
        <EnvironmentProviderSettings
          environmentId={environmentId}
          environmentLabel="Remote device"
          {...(options?.readOnly === undefined ? {} : { readOnly: options.readOnly })}
          {...(options?.targetInstanceId === undefined
            ? {}
            : { targetInstanceId: options.targetInstanceId })}
        />
      </div>
    </RegistryContext.Provider>
  );
}

// The section header and the end of the provider list both offer Add provider.

async function setup() {
  await page.viewport(1280, 900);
  state.settings = DEFAULT_UNIFIED_SETTINGS;
  state.canManageProviders = true;
  state.canWriteSettings = true;
  state.searchTargetId = null;
  state.providerAuth = null;
  state.readEnvironmentIds = [];
  state.updateEnvironmentIds = [];
  state.mutationEnvironmentIds = [];
  state.updateSettings.mockReset();
  state.updateModelPreferences.mockReset();
  state.toggleFavorite.mockReset();
  state.mutateProviderInstance.mockReset().mockResolvedValue(AsyncResult.success({}));
  state.confirm.mockReset().mockResolvedValue(false);
  state.refresh.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.updateProvider.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.uninstall.mockReset().mockResolvedValue(AsyncResult.success({}));
  state.acceptUrlAuth.mockReset().mockResolvedValue(AsyncResult.success({ accepted: true }));
  await setProviders([]);
}

describe("EnvironmentProviderSettings routing", () => {
  it("does not substitute another account when the requested instance was removed", async () => {
    await setup();
    await setProviders([provider()]);
    await using _screen = await render(panel({ targetInstanceId: customId }));
    await expect
      .element(page.getByText("This provider instance is no longer available on this device."))
      .toBeVisible();
    expect(state.updateSettings).not.toHaveBeenCalled();
  });

  it("updates one provider instance without sending a stale whole map", async () => {
    await setup();
    state.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [customId]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          displayName: "Work",
        },
      },
    };
    await using _screen = await render(panel());
    await userEvent.click(page.getByRole("switch", { name: "Enable Work" }).first());

    expect(state.mutateProviderInstance).toHaveBeenCalledWith(
      {
        operation: "upsert",
        instanceId: customId,
        instance: { driver: ProviderDriverKind.make("codex"), enabled: false, displayName: "Work" },
      },
      {},
    );
  });

  it.each([false, true])(
    "builds a custom model save on the last one before its config echo (replied %s)",
    async (replied) => {
      await setup();
      const first = { slug: "model-a", name: "Original A" };
      const second = { slug: "model-b", name: "Original B" };
      const stored = (customModels: ReadonlyArray<{ slug: string; name: string }>) => ({
        ...DEFAULT_UNIFIED_SETTINGS,
        providerInstances: {
          [customId]: { driver: ProviderDriverKind.make("codex"), config: { customModels } },
        },
      });
      state.settings = stored([first, second]);
      const replies: Array<() => void> = [];
      state.mutateProviderInstance.mockImplementation(
        () => new Promise((resolve) => replies.push(() => resolve(AsyncResult.success({})))),
      );
      await using screen = await render(panel({ targetInstanceId: customId }));
      const rename = async (slug: string, name: string) => {
        await userEvent.click(screen.getByRole("button", { name: `Edit ${slug}`, exact: true }));
        await userEvent.fill(
          screen.getByRole("textbox", { name: "Display name", exact: true }),
          name,
        );
        await userEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
      };

      await rename("model-a", "Entered A");
      if (replied) await act(() => replies[0]!());
      await rename("model-b", "Entered B");

      expect(state.mutateProviderInstance.mock.calls[1]?.[0]).toEqual({
        operation: "upsert",
        instanceId: customId,
        instance: {
          driver: ProviderDriverKind.make("codex"),
          config: {
            customModels: [
              { ...first, name: "Entered A" },
              { ...second, name: "Entered B" },
            ],
          },
        },
      });

      // The first save's echo lands after both replied, ahead of the second's.
      await act(() => replies.forEach((reply) => reply()));
      state.settings = stored([{ ...first, name: "Entered A" }, second]);
      await screen.rerender(panel({ targetInstanceId: customId }));
      await rename("model-a", "Again A");
      expect(state.mutateProviderInstance.mock.calls[2]?.[0].instance.config.customModels).toEqual([
        { ...first, name: "Again A" },
        { ...second, name: "Entered B" },
      ]);
    },
  );

  it("preserves a failed model draft for retry without including it in another edit", async () => {
    await setup();
    const first = { slug: "model-a", name: "Original A" };
    const second = { slug: "model-b", name: "Original B" };
    state.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [customId]: {
          driver: ProviderDriverKind.make("codex"),
          config: { customModels: [first, second] },
        },
      },
    };
    state.mutateProviderInstance
      .mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Save failed"))))
      .mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Still offline"))));
    await using screen = await render(panel({ targetInstanceId: customId }));
    await screen.getByRole("button", { name: "Edit model-a", exact: true }).click();
    const displayName = screen.getByRole("textbox", { name: "Display name", exact: true });
    await userEvent.fill(displayName, "Entered A");
    const save = screen.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect.element(save).toBeEnabled();
    await expect.element(displayName).toHaveValue("Entered A");
    await save.click();
    await expect.element(save).toBeEnabled();
    expect(state.mutateProviderInstance.mock.calls[1]?.[0].instance.config.customModels).toEqual([
      { ...first, name: "Entered A" },
      second,
    ]);
    await screen.getByRole("button", { name: "Cancel", exact: true }).click();
    await screen.getByRole("button", { name: "Edit model-b", exact: true }).click();
    await userEvent.fill(displayName, "Entered B");
    await save.click();
    await expect.element(displayName).not.toBeInTheDocument();
    expect(state.mutateProviderInstance.mock.calls[2]?.[0].instance.config.customModels).toEqual([
      first,
      { ...second, name: "Entered B" },
    ]);
  });

  it("routes explicit ACP browser authentication consent to the selected environment", async () => {
    await setup();
    const instanceId = ProviderInstanceId.make("acpRegistry_antigravity");
    const action = {
      elicitationId: "google-login-1",
      url: "https://accounts.google.com/login",
      message: "Continue with Google",
    };
    state.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("acpRegistry"),
          enabled: true,
          config: { agentId: "antigravity" },
        },
      },
    };
    await setProviders([
      {
        ...provider(),
        instanceId,
        driver: ProviderDriverKind.make("acpRegistry"),
        auth: { status: "unauthenticated", action },
      },
    ]);
    await using _screen = await render(panel({ targetInstanceId: instanceId }));
    const link = page.getByRole("link", { name: "Continue authentication" });
    link.element().addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(link);

    expect(state.acceptUrlAuth).toHaveBeenCalledWith({
      environmentId,
      input: { instanceId, elicitationId: action.elicitationId },
    });
  });

  it("lets a signed-out managed Codex account switch to the existing CLI", async () => {
    await setup();
    const codex = ProviderDriverKind.make("codex");
    state.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [codexId]: {
          driver: codex,
          enabled: true,
          config: { enabled: true, setupMode: "managed" },
        },
      },
    };
    state.providerAuth = {
      instanceId: codexId,
      phase: "idle",
      flowId: null,
      authorizationUrl: null,
      expiresAt: null,
      message: null,
      methods: [{ id: "chatgpt-profile:work", name: "Work", description: null, type: "agent" }],
    };
    await setProviders([
      {
        ...provider(),
        auth: { status: "unauthenticated" },
        setup: { canAuthenticate: true, canInstall: true },
      },
    ]);
    await using _screen = await render(panel({ targetInstanceId: codexId }));
    await expect.element(page.getByRole("button", { name: "Reconnect account" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Use existing CLI" }).element());

    expect(state.mutateProviderInstance).toHaveBeenCalledWith(
      {
        operation: "upsert",
        instanceId: codexId,
        instance: {
          driver: codex,
          enabled: true,
          config: { enabled: true, setupMode: "existing" },
        },
      },
      {},
    );
  });
});

describe("EnvironmentProviderSettings provider list", () => {
  it("opens a provider as its own page from a click near its row's edge, and the trail returns to the list", async () => {
    await setup();
    await setProviders([provider()]);
    await using _screen = await render(
      <>
        <SettingsBreadcrumb pathname="/settings/providers" />
        {panel()}
      </>,
      { router: "/settings/providers" },
    );
    const open = page.getByRole("button", { name: "Open Claude" });
    const row = page.elementLocator(open.element().closest('[data-slot="settings-row"]')!);
    // The list is rows to open, not an editor beside them.
    expect(document.querySelector("[data-provider-detail]")).toBeNull();
    await expect.element(page.getByText("Display name")).not.toBeInTheDocument();

    await userEvent.click(row, { position: { x: 3, y: 3 } });

    const trail = page.getByRole("navigation", { name: "Settings breadcrumb" });
    await expect.element(page.getByText("Display name")).toBeVisible();
    await expect.element(trail).toMatchTextContent("Providers");
    await expect.element(trail).toMatchTextContent("Claude");
    await expect.element(open).not.toBeInTheDocument();

    await userEvent.click(trail.getByRole("button", { name: "Providers" }));

    await expect.element(open).toBeVisible();
    await expect.element(page.getByText("Display name")).not.toBeInTheDocument();
  });
});

describe("EnvironmentProviderSettings page", () => {
  it("titles an opened provider by its name and shows its default name as a real value", async () => {
    await setup();
    await setProviders([provider()]);
    await using _screen = await render(
      <>
        <SettingsPageHeader />
        {panel({ targetInstanceId: codexId })}
      </>,
      { router: "/settings/providers" },
    );

    await expect.element(page.getByRole("heading", { level: 1 })).toHaveTextContent("Codex");
    await expect
      .element(page.getByText("Its account, setup, runtime and models on this device."))
      .toBeVisible();
    const name = page.getByRole("textbox", { name: "Codex" });
    await expect.element(name).toHaveValue("Codex");
  });
});

describe("EnvironmentProviderSettings status wording", () => {
  it("claims nothing before the server has reported a provider: a Checking chip, never Needs attention", async () => {
    await setup();
    state.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [customId]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          displayName: "Work",
        },
      },
    };
    await setProviders([]);
    await using _screen = await render(panel(), { router: "/settings/providers" });

    await expect.element(page.getByText("Work", { exact: true })).toBeVisible();
    const row = document.querySelector("[data-provider-row]")!.parentElement!;
    expect(row.querySelector("[data-settings-status]")?.getAttribute("data-settings-status")).toBe(
      "checking",
    );
    expect(row.textContent).not.toContain("Needs attention");
    expect(row.textContent).not.toContain("Waiting for the server to report");
  });

  it("stops saying Checking for a provider the server never lists: after ten seconds the row says so", async () => {
    using _timers = fakeTimers();
    await setup();
    state.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [customId]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          displayName: "Work",
        },
      },
    };
    await setProviders([]);
    await using _screen = await render(panel(), { router: "/settings/providers" });

    const row = () => document.querySelector("[data-provider-row]")!.parentElement!;
    const chip = () =>
      row().querySelector("[data-settings-status]")?.getAttribute("data-settings-status");
    expect(chip()).toBe("checking");
    await act(() => vi.advanceTimersByTimeAsync(UNREPORTED_PROVIDER_MS + 500));
    expect(chip()).toBe("attention");
    expect(row().textContent).toContain("The server has not reported on this provider.");
  });

  it("says a ready provider's state once, as a Ready chip, with the plan as plain text and no Available or Authenticated beside it", async () => {
    await setup();
    await setProviders([provider()]);
    await using _screen = await render(panel(), { router: "/settings/providers" });

    const row = document.querySelector("[data-provider-row]")!.parentElement!;
    await expect.element(row.querySelector("[data-settings-status]") as HTMLElement).toBeVisible();
    expect(row.querySelector("[data-settings-status]")!.textContent).toBe("Ready");
    for (const word of ["Available", "Authenticated", "Unavailable", "Disabled"]) {
      expect(row.textContent, word).not.toContain(word);
    }
  });
});

describe("EnvironmentProviderSettings provider page status", () => {
  it("shows the same Ready chip in the Status row of a provider's own page, with no Available line beside it", async () => {
    await setup();
    await setProviders([provider()]);
    await using _screen = await render(panel({ targetInstanceId: codexId }), {
      router: "/settings/providers",
    });

    await expect.element(page.getByText("Status", { exact: true })).toBeVisible();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-settings-status]")?.textContent).toBe("Ready"),
    );
    const line = document.querySelector("[data-settings-status]")!.parentElement!;
    expect(line.textContent).not.toContain("Available");
  });
});

describe("EnvironmentProviderSettings narrow list", () => {
  it("shows a provider's whole name beside its status chip in a 260 px list, the chip wrapping under it", async () => {
    await setup();
    await setProviders([provider()]);
    const narrow = document.createElement("div");
    narrow.style.width = "260px";
    await using _screen = await render(panel(), {
      container: narrow,
      router: "/settings/providers",
    });

    const row = document.querySelector("[data-provider-row]")!.parentElement!;
    const name = row.querySelector<HTMLElement>("span.truncate")!;
    const chip = row.querySelector<HTMLElement>("[data-settings-status]")!;
    await expect.element(chip).toBeVisible();
    expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
    expect(chip.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    expect(chip.getBoundingClientRect().right).toBeLessThanOrEqual(260);
  });
});

describe("EnvironmentProviderSettings keyboard", () => {
  it("draws a focus ring on the Add provider row when the keyboard reaches it", async () => {
    await setup();
    await setProviders([provider()]);
    await using _screen = await render(panel(), { router: "/settings/providers" });
    const add = page.getByRole("button", { name: "Add provider" }).last();
    await expect.element(add).toBeVisible();

    // A key press first, so the browser treats the focus that follows as the keyboard's.
    await userEvent.keyboard("{Shift}");
    (add.element() as HTMLElement).focus();

    expect((add.element() as HTMLElement).matches(":focus-visible")).toBe(true);
    expect(getComputedStyle(add.element()).boxShadow).not.toBe("none");
  });
});

describe("EnvironmentProviderSettings account email", () => {
  it("keeps the email behind a Hidden pill until its Show button reveals it, and hides it again", async () => {
    await setup();
    const email = "developer@example.com";
    await setProviders([{ ...provider(), auth: { status: "authenticated", email } }]);
    await using _screen = await render(panel({ targetInstanceId: codexId }));
    const toggle = page.getByRole("button", { name: "Toggle account email visibility" });
    // The value (or its pill) and a small Show or Hide button sit side by side.
    const shown = () => toggle.element().parentElement!.textContent;

    await expect.poll(shown).toContain("Hidden");
    expect(shown()).not.toContain("developer@example.com");
    await expect.element(toggle).toHaveTextContent("Show");

    await userEvent.click(toggle);
    await expect.poll(shown).toContain("developer@example.com");
    await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
    await expect.element(toggle).toHaveTextContent("Hide");

    await userEvent.click(toggle);
    await expect.poll(shown).toContain("Hidden");
    expect(shown()).not.toContain("developer@example.com");
  });
});

describe("EnvironmentProviderSettings instance removal", () => {
  it("resets a configured default instance only once the user confirms", async () => {
    await setup();
    state.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [codexId]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          config: { binaryPath: "/opt/codex/bin/codex" },
        },
      },
    };
    await setProviders([provider()]);
    await using _screen = await render(panel({ targetInstanceId: codexId }));
    const reset = page.getByRole("button", { name: "Reset Codex provider settings to default" });
    await userEvent.click(reset);

    expect(state.mutateProviderInstance).not.toHaveBeenCalled();
    expect(state.confirm).toHaveBeenCalledOnce();

    state.confirm.mockResolvedValue(true);
    await userEvent.click(reset);
    await vi.waitFor(() =>
      expect(state.mutateProviderInstance).toHaveBeenCalledWith({
        operation: "remove",
        instanceId: codexId,
      }),
    );
  });

  it("warns that resetting an enabled default-off provider turns it off", async () => {
    await setup();
    const antigravityId = ProviderInstanceId.make("antigravity");
    const antigravity = ProviderDriverKind.make("antigravity");
    state.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [antigravityId]: {
          driver: antigravity,
          enabled: true,
          config: { binaryPath: "/opt/antigravity/bin/agy" },
        },
      },
    };
    await setProviders([{ ...provider(), instanceId: antigravityId, driver: antigravity }]);
    await using _screen = await render(panel({ targetInstanceId: antigravityId }));
    await userEvent.click(page.getByRole("button", { name: /^Reset .* provider settings/ }));

    expect(state.confirm).toHaveBeenCalledWith(
      expect.stringContaining("It will also be turned off."),
      {
        variant: "destructive",
        confirmLabel: "Reset provider",
      },
    );
    expect(state.mutateProviderInstance).not.toHaveBeenCalled();
  });

  it("deletes a custom instance only once the user confirms", async () => {
    await setup();
    state.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [customId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
      },
    };
    await using _screen = await render(panel({ targetInstanceId: customId }));
    const remove = page.getByRole("button", { name: `Delete instance ${customId}` });
    await userEvent.click(remove);

    expect(state.mutateProviderInstance).not.toHaveBeenCalled();
    expect(state.confirm).toHaveBeenCalledOnce();

    state.confirm.mockResolvedValue(true);
    await userEvent.click(remove);
    await vi.waitFor(() =>
      expect(state.mutateProviderInstance).toHaveBeenCalledWith({
        operation: "remove",
        instanceId: customId,
      }),
    );
  });
});

describe("EnvironmentProviderSettings health check interval", () => {
  it("commits interval drafts on blur and Enter and allows retrying rejected edits", async () => {
    await setup();
    await using _screen = await render(panel());
    const input = page.getByRole("textbox", { name: "Provider health check interval in seconds" });

    await userEvent.type(input, "{ArrowUp}{ArrowDown}");
    expect(
      state.updateSettings.mock.calls.map(([patch]) =>
        Duration.toSeconds(patch.backgroundActivity.overrides.providerHealthRefreshInterval),
      ),
    ).toEqual([330, 300]);
    state.updateSettings.mockClear();

    // Replacing 300 with 120 passes through 30, 3, an empty field, 1 and 12.
    await userEvent.type(input, "{Backspace}{Backspace}{Backspace}120");
    await expect.element(input).toHaveValue("120");
    expect(state.updateSettings).not.toHaveBeenCalled();

    await userEvent.tab();
    expect(
      state.updateSettings.mock.calls.map(([patch]) =>
        Duration.toSeconds(patch.backgroundActivity.overrides.providerHealthRefreshInterval),
      ),
    ).toEqual([120]);

    await act(() => state.updateSettings.mock.calls.at(-1)?.[1]?.onFailed?.());
    await expect.element(input).toHaveValue("300");
    await userEvent.type(input, "{Backspace}{Backspace}{Backspace}120");
    // An Enter that confirms an IME candidate must not commit.
    for (const composition of [
      { isComposing: true, keyCode: 13 },
      { isComposing: false, keyCode: 229 },
    ]) {
      await act(() =>
        input.element().dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            ...composition,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    }
    expect(state.updateSettings).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Enter}");
    await expect.element(input).toHaveFocus();
    expect(
      state.updateSettings.mock.calls.map(([patch]) =>
        Duration.toSeconds(patch.backgroundActivity.overrides.providerHealthRefreshInterval),
      ),
    ).toEqual([120, 120]);

    const rejectPrevious = state.updateSettings.mock.calls.at(-1)?.[1]?.onFailed;
    await userEvent.type(input, "{ArrowUp}");
    await act(() => rejectPrevious?.());
    await expect.element(input).toHaveValue("150");
  });

  it("restores the saved interval when a cleared field loses focus", async () => {
    await setup();
    await using _screen = await render(panel());
    const input = page.getByRole("textbox", { name: "Provider health check interval in seconds" });

    await userEvent.type(input, "{Backspace}{Backspace}{Backspace}");
    await userEvent.tab();

    await expect.element(input).toHaveValue("300");
    expect(state.updateSettings).not.toHaveBeenCalled();
  });
});

/** The provider page through a real router: its address, Back and Forward, and the breadcrumb. */
function providersRouter(entry: string) {
  // The browser's own history: Back and Forward arrive as popstate, which a memory history never
  // sends, and which the router asks its blockers about.
  window.history.replaceState(null, "", entry);
  const root = createRootRoute();
  function Page() {
    const { instanceId, onSelectInstance, returnFocusRow } = useProviderInstanceRoute();
    return (
      <RegistryContext.Provider value={appAtomRegistry}>
        <SettingsBreadcrumb pathname="/settings/providers" />
        <SettingsPageHeader />
        <input aria-label="Unrelated field" />
        <div className="@container/providers">
          <EnvironmentProviderSettings
            environmentId={environmentId}
            environmentLabel="Remote device"
            {...(instanceId === undefined ? {} : { targetInstanceId: instanceId })}
            onSelectInstance={onSelectInstance}
            {...(returnFocusRow === undefined ? {} : { returnFocusRow })}
          />
        </div>
      </RegistryContext.Provider>
    );
  }
  const route = createRoute({
    getParentRoute: () => root,
    path: "/settings/providers",
    validateSearch: ProvidersRoute.options.validateSearch!,
    component: Page,
  });
  return createRouter({
    routeTree: root.addChildren([route]),
    history: createBrowserHistory(),
  });
}

describe("provider page through the router", () => {
  const rowButton = () => page.getByRole("button", { name: "Open Codex" });
  const heading = () => page.getByRole("heading", { level: 1 });
  const upserts = () =>
    state.mutateProviderInstance.mock.calls.filter(
      ([operation]) => (operation as { operation: string }).operation === "upsert",
    );

  async function openPage(entry = "/settings/providers") {
    await setup();
    await setProviders([provider()]);
    const router = providersRouter(entry);
    const screen = await render(<RouterProvider router={router} />, { router: false });
    return { router, screen };
  }

  it("opens a provider from the keyboard, focuses its title, and returns focus to its row on Back and again on Forward", async () => {
    const { router, screen } = await openPage();
    await using _screen = screen;
    await expect.element(rowButton()).toBeVisible();
    (rowButton().element() as HTMLElement).focus();

    await userEvent.keyboard("{Enter}");

    await expect.poll(() => router.state.location.search).toEqual({ instanceId: codexId });
    await expect.element(heading()).toHaveTextContent("Codex");
    await expect.element(heading()).toHaveFocus();

    await act(async () => router.history.back());
    await expect.element(rowButton()).toHaveFocus();
    expect(router.state.location.search).toEqual({});

    await act(async () => router.history.forward());
    await expect.element(heading()).toHaveTextContent("Codex");
    await expect.element(heading()).toHaveFocus();

    // The second Back lands on the row again: the list entry kept which provider it was left by.
    await act(async () => router.history.back());
    await expect.element(rowButton()).toHaveFocus();
  });

  it("leaves a field outside the provider page alone when a move keeps the same provider open", async () => {
    const { router, screen } = await openPage("/settings/providers?instanceId=codex");
    await using _screen = screen;
    const unrelated = page.getByRole("textbox", { name: "Unrelated field" });
    await userEvent.fill(unrelated, "draft");
    await expect.element(unrelated).toHaveFocus();

    await act(async () =>
      router.navigate({ to: "/settings/providers", search: { instanceId: codexId }, hash: "top" }),
    );

    await expect.poll(() => router.state.location.hash).toBe("top");
    await expect.element(unrelated).toHaveFocus();
    expect(upserts()).toHaveLength(0);
  });

  it("commits a name being typed when browser Back leaves the provider", async () => {
    const { router, screen } = await openPage();
    await using _screen = screen;
    await expect.element(rowButton()).toBeVisible();
    await userEvent.click(rowButton(), { position: { x: 5, y: 5 } });
    const name = page.getByRole("textbox", { name: "Codex" });
    await expect.element(name).toBeVisible();
    await userEvent.fill(name, "Work");
    await expect.element(name).toHaveFocus();
    expect(upserts()).toHaveLength(0);

    await act(async () => router.history.back());

    await expect.poll(() => upserts().length).toBe(1);
    expect(upserts()[0]![0]).toMatchObject({
      operation: "upsert",
      instanceId: codexId,
      instance: { displayName: "Work" },
    });
  });

  it("commits a name being typed when the breadcrumb returns to the list, and lands on its row", async () => {
    const { screen } = await openPage("/settings/providers?instanceId=codex");
    await using _screen = screen;
    const name = page.getByRole("textbox", { name: "Codex" });
    await userEvent.fill(name, "Work");

    await userEvent.click(
      page.getByRole("navigation", { name: "Settings breadcrumb" }).getByRole("button", {
        name: "Providers",
      }),
    );

    await expect.poll(() => upserts().length).toBe(1);
    // A provider opened from its address has no list entry behind it; the breadcrumb's list entry
    // remembers it, so focus lands on its row.
    await expect.element(rowButton()).toHaveFocus();
  });

  it("keeps a Codex provider's runtime paths and launch arguments in a closed Advanced section, with the page's own What is this?", async () => {
    const { screen } = await openPage("/settings/providers?instanceId=codex");
    await using _screen = screen;
    await expect.element(heading()).toHaveTextContent("Codex");
    // Closed: the paths are not on screen until the section is opened.
    expect(document.body.textContent).not.toContain("CODEX_HOME");
    expect(document.body.textContent).not.toContain("Launch arguments");
    await expect.element(page.getByRole("button", { name: "What is this?" }).first()).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: /^Advanced/ }));
    await expect.element(page.getByText("Most people never change these.")).toBeVisible();
  });

  it("opens a provider straight from its address, titled by its name", async () => {
    const { screen } = await openPage("/settings/providers?instanceId=codex");
    await using _screen = screen;
    await expect.element(heading()).toHaveTextContent("Codex");
    await expect.element(page.getByRole("textbox", { name: "Codex" })).toBeVisible();
    await expect.element(rowButton()).not.toBeInTheDocument();
  });
});
