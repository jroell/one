import type { ProviderInstanceConfig, ServerProvider } from "@t3tools/contracts";
import { resolveProviderInstanceEnabled } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { chooseProviderFix, withProviderInstanceEnabled } from "./explainProviderFix.logic";

// What ClaudeProvider.ts and CodexProvider.ts emit for a provider switched off in settings:
// enabled false, not installed, sign-in unknown, status warning.
const disabledSnapshot = (instanceId: string, driver: string, displayName: string) =>
  ({
    instanceId,
    driver,
    displayName,
    enabled: false,
    installed: false,
    version: null,
    status: "warning",
    auth: { status: "unknown" },
    models: [],
    slashCommands: [],
    skills: [],
    checkedAt: "2026-11-26T12:00:00.000Z",
  }) as unknown as ServerProvider;

const readySnapshot = (instanceId: string, driver: string) =>
  ({
    instanceId,
    driver,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    models: [],
    slashCommands: [],
    skills: [],
    checkedAt: "2026-11-26T12:00:00.000Z",
  }) as unknown as ServerProvider;

const NOW = Date.parse("2026-11-26T12:00:00.000Z");

const claudeOff = { driver: "claudeAgent", enabled: false } as unknown as ProviderInstanceConfig;

describe("the fix offered when no AI provider is ready", () => {
  it("turns on the provider the person switched off, though the server reports it as not installed", () => {
    const fix = chooseProviderFix({
      now: NOW,
      instances: { claudeAgent: claudeOff },
      providers: [disabledSnapshot("claudeAgent", "claudeAgent", "Claude")],
    });
    expect(fix).toMatchObject({ kind: "turn-on", instanceId: "claudeAgent", name: "Claude" });
  });

  it("prefers a default provider over an added or dev instance that is also off", () => {
    const replayOff = { driver: "acp", enabled: false } as unknown as ProviderInstanceConfig;
    expect(
      chooseProviderFix({
        now: NOW,
        instances: { devReplay: replayOff, claudeAgent: claudeOff },
        providers: [disabledSnapshot("claudeAgent", "claudeAgent", "Claude")],
      }),
    ).toMatchObject({ kind: "turn-on", instanceId: "claudeAgent" });
  });

  it("turns on another provider when the only ready one has no usage left", () => {
    const outOfUsage = {
      ...readySnapshot("codex", "codex"),
      usageLimits: {
        checkedAt: "2026-11-26T11:59:00.000Z",
        windows: [{ id: "primary", usedPercent: 100, resetsAt: "2026-11-30T12:00:00.000Z" }],
      },
    } as unknown as ServerProvider;
    expect(
      chooseProviderFix({
        now: NOW,
        instances: { claudeAgent: claudeOff },
        providers: [outOfUsage, disabledSnapshot("claudeAgent", "claudeAgent", "Claude")],
      }),
    ).toMatchObject({ kind: "turn-on", instanceId: "claudeAgent" });
  });

  it("opens the Providers page when no instance of the person's was switched off", () => {
    expect(
      chooseProviderFix({
        now: NOW,
        instances: { codex: { driver: "codex" } as unknown as ProviderInstanceConfig },
        providers: [disabledSnapshot("devReplay", "acp", "Replay")],
      }),
    ).toEqual({ kind: "open-providers" });
    expect(chooseProviderFix({ instances: undefined, providers: [], now: NOW })).toEqual({
      kind: "open-providers",
    });
  });

  it("offers nothing when a provider is ready, because the reason is then something else", () => {
    expect(
      chooseProviderFix({
        now: NOW,
        instances: { claudeAgent: claudeOff },
        providers: [
          readySnapshot("codex", "codex"),
          disabledSnapshot("claudeAgent", "claudeAgent", "Claude"),
        ],
      }),
    ).toEqual({ kind: "none" });
  });

  it("sets both the top-level flag and the one inside config, so the instance reads as enabled", () => {
    const off = {
      driver: "claudeAgent",
      enabled: false,
      config: { enabled: false, binaryPath: "/usr/local/bin/claude" },
    } as unknown as ProviderInstanceConfig;
    expect(resolveProviderInstanceEnabled(off)).toBe(false);
    // Setting only the top-level flag is not enough.
    expect(resolveProviderInstanceEnabled({ ...off, enabled: true })).toBe(false);
    const on = withProviderInstanceEnabled(off);
    expect(resolveProviderInstanceEnabled(on)).toBe(true);
    expect(on.config).toEqual({ enabled: true, binaryPath: "/usr/local/bin/claude" });
  });
});
