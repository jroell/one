import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { deriveUsageLimitRecovery } from "./chatUsageRecovery";

const now = Date.parse("2026-11-26T12:00:00.000Z");
const CODEX = ProviderInstanceId.make("codex");
const CLAUDE = ProviderInstanceId.make("claudeAgent");
const failed = { instanceId: CODEX, model: "gpt-6.2-astra" };

function provider(
  instanceId: ProviderInstanceId,
  driver: string,
  slug: string,
  name: string,
  overrides: object = {},
): ServerProvider {
  return {
    instanceId,
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-26T11:00:00.000Z",
    models: [{ slug, name, isCustom: false, isDefault: true, capabilities: null }],
    slashCommands: [],
    skills: [],
    ...overrides,
  } as ServerProvider;
}

const astra = provider(CODEX, "codex", "gpt-6.2-astra", "6 Astra");
const claude = provider(CLAUDE, "claudeAgent", "claude-opus-5-5", "Opus 5.5");

it("names the model that ran out and offers the first other ready provider with usage left", () => {
  const recovery = deriveUsageLimitRecovery({
    failedSelection: failed,
    resetsAt: "2026-11-30T16:46:00.000Z",
    providers: [astra, claude],
    now,
  });
  expect(recovery).toEqual({
    failedModel: "6 Astra",
    resetsAt: "2026-11-30T16:46:00.000Z",
    alternative: {
      selection: { instanceId: CLAUDE, model: "claude-opus-5-5" },
      providerName: "Claude",
    },
  });
});

it("offers nothing when the only other provider is signed out or out of usage itself", () => {
  const signedOut = provider(CLAUDE, "claudeAgent", "claude-opus-5-5", "Opus 5.5", {
    auth: { status: "unauthenticated" },
  });
  const out = provider(CLAUDE, "claudeAgent", "claude-opus-5-5", "Opus 5.5", {
    usageLimits: {
      windows: [
        {
          id: "five_hour",
          kind: "session",
          label: "Session",
          usedPercent: 100,
          windowDurationMins: 300,
          resetsAt: "2026-11-27T09:00:00.000Z",
        },
      ],
    },
  });
  for (const other of [signedOut, out]) {
    expect(
      deriveUsageLimitRecovery({
        failedSelection: failed,
        resetsAt: null,
        providers: [astra, other],
        now,
      }).alternative,
    ).toBeNull();
  }
});

it("never offers the provider that ran out back to the person", () => {
  expect(
    deriveUsageLimitRecovery({ failedSelection: failed, resetsAt: null, providers: [astra], now })
      .alternative,
  ).toBeNull();
});
