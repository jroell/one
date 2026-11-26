import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { chooseGuidedModel, earliestUsageReset, firstProviderWithUsageLeft } from "./guidedModel";

const now = Date.parse("2026-11-26T12:00:00.000Z");
const CODEX = ProviderInstanceId.make("codex");
const CLAUDE = ProviderInstanceId.make("claudeAgent");
const GROK = ProviderInstanceId.make("grok");

function model(slug: string): ServerProviderModel {
  return { slug, name: slug, isCustom: false, isDefault: true, capabilities: null };
}

/** `usedPercent` 100 with a reset in the future is an exhausted window. */
function provider(
  instanceId: ProviderInstanceId,
  driver: string,
  slug: string,
  overrides: Partial<ServerProvider> = {},
  usage?: { readonly usedPercent: number; readonly resetsAt?: string },
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
    models: [model(slug)],
    slashCommands: [],
    skills: [],
    ...(usage
      ? {
          usageLimits: {
            windows: [
              {
                id: "five_hour",
                kind: "session",
                label: "Session",
                usedPercent: usage.usedPercent,
                windowDurationMins: 300,
                ...(usage.resetsAt ? { resetsAt: usage.resetsAt } : {}),
              },
            ],
          },
        }
      : {}),
    ...overrides,
  } as ServerProvider;
}

const FULL = { usedPercent: 100, resetsAt: "2026-11-30T16:46:00.000Z" };
const codexOut = provider(CODEX, "codex", "gpt-6.2-astra", {}, FULL);
const claudeReady = provider(CLAUDE, "claudeAgent", "claude-opus-5-5");
const current = { instanceId: CODEX, model: "gpt-6.2-astra" };

it("keeps the draft's model when its provider has no exhausted usage window", () => {
  const codexFine = provider(CODEX, "codex", "gpt-6.2-astra", {}, { usedPercent: 40 });
  expect(chooseGuidedModel({ current, providers: [codexFine, claudeReady], now })).toEqual({
    kind: "keep",
  });
});

it("keeps the draft's model when its window already reset", () => {
  const reset = provider(
    CODEX,
    "codex",
    "gpt-6.2-astra",
    {},
    { usedPercent: 100, resetsAt: "2026-11-26T11:00:00.000Z" },
  );
  expect(chooseGuidedModel({ current, providers: [reset, claudeReady], now })).toEqual({
    kind: "keep",
  });
});

it("switches to the first ready provider with usage left when the draft's provider is out of usage", () => {
  const signedOut = provider(ProviderInstanceId.make("gemini"), "gemini", "gemini-4", {
    auth: { status: "unauthenticated" },
  });
  const alsoOut = provider(GROK, "grok", "grok-4.7", {}, FULL);
  const disabled = provider(ProviderInstanceId.make("opencode"), "opencode", "x", {
    enabled: false,
  });
  expect(
    chooseGuidedModel({
      current,
      providers: [codexOut, signedOut, alsoOut, disabled, claudeReady],
      now,
    }),
  ).toEqual({ kind: "switch", selection: { instanceId: CLAUDE, model: "claude-opus-5-5" } });
});

it("reports the earliest reset when every ready provider is out of usage", () => {
  const claudeOut = provider(
    CLAUDE,
    "claudeAgent",
    "claude-opus-5-5",
    {},
    { usedPercent: 100, resetsAt: "2026-11-27T09:00:00.000Z" },
  );
  expect(chooseGuidedModel({ current, providers: [codexOut, claudeOut], now })).toEqual({
    kind: "none",
    resetsAt: "2026-11-27T09:00:00.000Z",
  });
  expect(earliestUsageReset([codexOut, claudeOut], now)).toBe("2026-11-27T09:00:00.000Z");
});

it("gives no reset time when the exhausted windows do not say when they reset", () => {
  const undated = provider(CODEX, "codex", "gpt-6.2-astra", {}, { usedPercent: 100 });
  expect(chooseGuidedModel({ current, providers: [undated], now })).toEqual({
    kind: "none",
    resetsAt: null,
  });
});

it("finds nothing when no provider is ready", () => {
  expect(
    firstProviderWithUsageLeft([provider(CLAUDE, "claudeAgent", "m", { status: "error" })], now),
  ).toBeNull();
});
