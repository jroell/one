import {
  EnvironmentId,
  MESSAGE_AGENT_CONTEXT_MAX_CHARS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import {
  conversationAvailability,
  startGuidedConversation,
  type GuidedConversationDeps,
} from "./startConversation";
import { setWorkspaceMode } from "./workspaceMode";
import type { ComposerSendBridge, GuidedSendResult } from "./composerSendBridge";

const ENVIRONMENT = EnvironmentId.make("environment:local");
const RETURN = { label: "Settings / Providers", href: "/settings/providers" };

/** Whatever a test remembered about a way back is gone when the test ends. */
function freshReturns(): Disposable {
  const clear = () => window.sessionStorage.removeItem("one:guided-return");
  clear();
  return {
    [Symbol.dispose]: () => {
      clear();
      setWorkspaceMode("code");
    },
  };
}

const ASTRA: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-6.2-astra",
};
const CLAUDE: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-5-5",
};

function bridge(result: GuidedSendResult, threadKey = "draft-1", modelSelection = ASTRA) {
  const send = vi.fn(async (_input: { text: string; agentContext: string }) => result);
  const composer: ComposerSendBridge = {
    environmentId: ENVIRONMENT,
    threadKey,
    isDraft: true,
    modelSelection,
    send,
  };
  return { composer, send };
}

function deps(overrides: Partial<GuidedConversationDeps> = {}) {
  const discardDraft = vi.fn();
  const navigateTo = vi.fn();
  const sent = bridge({ ok: true, messageId: "message-1" });
  const value: GuidedConversationDeps = {
    scratchEnvironmentId: () => ENVIRONMENT,
    supportsAgentContext: () => true,
    openScratchDraft: async () => ({
      draftKey: "draft-1",
      threadKey: "environment:local:thread-1",
    }),
    discardDraft,
    navigateTo,
    composer: () => sent.composer,
    composerFor: async () => sent.composer,
    providersFor: () => [],
    now: () => NOW,
    setDraftModel: vi.fn(),
    ...overrides,
  };
  return { value, discardDraft, navigateTo, sent };
}

const NOW = Date.parse("2026-11-26T12:00:00.000Z");
const input = { visibleText: "What is this?", hiddenContext: "Explain the Providers page." };

it("sends the person's words and the hidden notes separately into a new thread, and remembers the way back", async () => {
  using _returns = freshReturns();
  const { value, discardDraft, sent } = deps();
  const result = await startGuidedConversation({ ...input, returnTo: RETURN }, value);
  expect(result).toEqual({ ok: true, threadKey: "environment:local:thread-1" });
  expect(sent.send).toHaveBeenCalledExactlyOnceWith({
    text: "What is this?",
    agentContext: "Explain the Providers page.",
  });
  expect(discardDraft).not.toHaveBeenCalled();
  const stored = JSON.parse(window.sessionStorage.getItem("one:guided-return")!);
  expect(stored["environment:local:thread-1"]).toEqual(RETURN);
});

it("refuses a message with nothing to send or notes over the limit, without opening a thread", async () => {
  using _returns = freshReturns();
  const openScratchDraft = vi.fn();
  const { value } = deps({ openScratchDraft });
  expect(await startGuidedConversation({ ...input, visibleText: "   " }, value)).toEqual({
    ok: false,
    reason: "empty-message",
  });
  expect(
    await startGuidedConversation(
      { ...input, hiddenContext: "x".repeat(MESSAGE_AGENT_CONTEXT_MAX_CHARS + 1) },
      value,
    ),
  ).toEqual({ ok: false, reason: "context-too-long" });
  expect(openScratchDraft).not.toHaveBeenCalled();
});

it("returns a typed reason, and sends nothing, when there is no place to start or the server is too old", async () => {
  using _returns = freshReturns();
  const none = deps({ scratchEnvironmentId: () => null });
  expect(await startGuidedConversation(input, none.value)).toEqual({
    ok: false,
    reason: "no-scratch-environment",
  });
  const old = deps({ supportsAgentContext: () => false });
  expect(await startGuidedConversation(input, old.value)).toEqual({
    ok: false,
    reason: "server-too-old",
  });
  expect(none.sent.send).not.toHaveBeenCalled();
  expect(old.sent.send).not.toHaveBeenCalled();
});

it.each([
  [{ ok: false, reason: "no-provider" } as const, "no-provider"],
  [{ ok: false, reason: "rejected", message: "Too long." } as const, "send-failed"],
  [{ ok: false, reason: "not-sent" } as const, "send-failed"],
])("takes the empty draft away and goes back when the send fails: %j", async (sent, reason) => {
  using _returns = freshReturns();
  const failing = bridge(sent);
  const { value, discardDraft, navigateTo } = deps({
    composer: () => failing.composer,
    composerFor: async () => failing.composer,
  });
  const result = await startGuidedConversation({ ...input, returnTo: RETURN }, value);
  expect(result.ok).toBe(false);
  expect(!result.ok && result.reason).toBe(reason);
  expect(discardDraft).toHaveBeenCalledExactlyOnceWith("draft-1");
  expect(navigateTo).toHaveBeenCalledExactlyOnceWith("/settings/providers");
  // No way back is kept for a thread that was never made.
  expect(window.sessionStorage.getItem("one:guided-return")).toBeNull();
});

it("takes the draft away when the composer never shows it", async () => {
  using _returns = freshReturns();
  const { value, discardDraft } = deps({ composerFor: async () => null });
  const result = await startGuidedConversation(input, value);
  expect(result).toEqual({ ok: false, reason: "send-failed" });
  expect(discardDraft).toHaveBeenCalledExactlyOnceWith("draft-1");
});

it("sends into the thread on screen and refuses while its composer holds a draft or the server is old", async () => {
  using _returns = freshReturns();
  const ok = deps();
  expect(await startGuidedConversation({ ...input, into: "current-thread" }, ok.value)).toEqual({
    ok: true,
    threadKey: "draft-1",
  });
  expect(ok.sent.send).toHaveBeenCalledOnce();

  const busy = bridge({ ok: false, reason: "draft-in-the-way" });
  expect(
    await startGuidedConversation(
      { ...input, into: "current-thread" },
      deps({ composer: () => busy.composer }).value,
    ),
  ).toEqual({ ok: false, reason: "draft-in-the-way", detail: null });

  expect(
    await startGuidedConversation(
      { ...input, into: "current-thread" },
      deps({ composer: () => null }).value,
    ),
  ).toEqual({ ok: false, reason: "no-composer" });
  const old = deps({ supportsAgentContext: () => false });
  expect(await startGuidedConversation({ ...input, into: "current-thread" }, old.value)).toEqual({
    ok: false,
    reason: "server-too-old",
  });
});

const provider = (overrides: object = {}) =>
  ({
    instanceId: "codex",
    driver: "codex",
    models: [{ slug: "gpt-6.2-astra", name: "6 Astra", isCustom: false, isDefault: true }],
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    ...overrides,
  }) as never;

const environments = (capable = true) =>
  [
    {
      environmentId: ENVIRONMENT,
      serverConfig: { environment: { capabilities: capable ? { messageAgentContext: true } : {} } },
    },
  ] as never;

const withProviders = (...list: ReadonlyArray<never>) => new Map([[ENVIRONMENT, list]]) as never;

it("says a conversation can start only with a place, a server that knows the field and a ready provider", () => {
  const code = (result: ReturnType<typeof conversationAvailability>) =>
    result.ok ? "ok" : result.code;
  expect(conversationAvailability(environments(), withProviders(provider()), ENVIRONMENT)).toEqual({
    ok: true,
  });
  expect(code(conversationAvailability(environments(), withProviders(provider()), null))).toBe(
    "no-scratch-environment",
  );
  expect(
    code(conversationAvailability(environments(false), withProviders(provider()), ENVIRONMENT)),
  ).toBe("server-too-old");
  for (const broken of [
    { enabled: false },
    { installed: false },
    { status: "error" },
    { auth: { status: "unauthenticated" } },
  ]) {
    expect(
      code(conversationAvailability(environments(), withProviders(provider(broken)), ENVIRONMENT)),
    ).toBe("no-provider");
  }
  // One ready provider among broken ones is enough.
  expect(
    conversationAvailability(
      environments(),
      withProviders(provider({ enabled: false }), provider()),
      ENVIRONMENT,
    ).ok,
  ).toBe(true);
  const refused = conversationAvailability(environments(), withProviders(), ENVIRONMENT);
  expect(!refused.ok && refused.reason.length > 10).toBe(true);
});

function accountProvider(
  selection: ModelSelection,
  driver: string,
  usedPercent: number,
  resetsAt?: string,
): ServerProvider {
  return {
    instanceId: selection.instanceId,
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-26T11:00:00.000Z",
    models: [{ slug: selection.model, name: selection.model, isCustom: false, isDefault: true }],
    slashCommands: [],
    skills: [],
    usageLimits: {
      windows: [
        {
          id: "five_hour",
          kind: "session",
          label: "Session",
          usedPercent,
          windowDurationMins: 300,
          ...(resetsAt ? { resetsAt } : {}),
        },
      ],
    },
  } as never;
}

const ASTRA_OUT = accountProvider(ASTRA, "codex", 100, "2026-11-30T16:46:00.000Z");
const CLAUDE_FINE = accountProvider(CLAUDE, "claudeAgent", 20);
const CLAUDE_OUT = accountProvider(CLAUDE, "claudeAgent", 100, "2026-11-27T09:00:00.000Z");

it("asks a model that can answer when the draft's own provider is out of usage, and sends only once the composer shows it", async () => {
  using _returns = freshReturns();
  const onAstra = bridge({ ok: true, messageId: "m-astra" }, "draft-1", ASTRA);
  const onClaude = bridge({ ok: true, messageId: "m-claude" }, "draft-1", CLAUDE);
  const setDraftModel = vi.fn();
  const { value } = deps({
    providersFor: () => [ASTRA_OUT, CLAUDE_FINE],
    setDraftModel,
    composerFor: async (_key, _timeout, accept) =>
      accept === undefined
        ? onAstra.composer
        : accept(onClaude.composer)
          ? onClaude.composer
          : null,
  });
  const result = await startGuidedConversation(input, value);
  expect(result).toEqual({ ok: true, threadKey: "environment:local:thread-1" });
  expect(setDraftModel).toHaveBeenCalledExactlyOnceWith("draft-1", CLAUDE);
  expect(onAstra.send).not.toHaveBeenCalled();
  expect(onClaude.send).toHaveBeenCalledExactlyOnceWith({
    text: "What is this?",
    agentContext: "Explain the Providers page.",
  });
});

it("leaves the draft's model alone when its provider has usage left", async () => {
  using _returns = freshReturns();
  const setDraftModel = vi.fn();
  const { value, sent } = deps({
    providersFor: () => [accountProvider(ASTRA, "codex", 30), CLAUDE_FINE],
    setDraftModel,
  });
  expect((await startGuidedConversation(input, value)).ok).toBe(true);
  expect(setDraftModel).not.toHaveBeenCalled();
  expect(sent.send).toHaveBeenCalledOnce();
});

it("sends nothing and gives the earliest reset when every ready account is out of usage", async () => {
  using _returns = freshReturns();
  const { value, sent, discardDraft, navigateTo } = deps({
    providersFor: () => [ASTRA_OUT, CLAUDE_OUT],
  });
  const result = await startGuidedConversation({ ...input, returnTo: RETURN }, value);
  expect(result).toEqual({
    ok: false,
    reason: "usage-limit",
    resetsAt: "2026-11-27T09:00:00.000Z",
  });
  expect(sent.send).not.toHaveBeenCalled();
  expect(discardDraft).toHaveBeenCalledExactlyOnceWith("draft-1");
  expect(navigateTo).toHaveBeenCalledExactlyOnceWith("/settings/providers");
});

it("takes the draft away when the composer never shows the model that was asked for", async () => {
  using _returns = freshReturns();
  const { value, sent, discardDraft } = deps({
    providersFor: () => [ASTRA_OUT, CLAUDE_FINE],
    composerFor: async (_key, _timeout, accept) => (accept === undefined ? sent.composer : null),
  });
  expect(await startGuidedConversation(input, value)).toEqual({
    ok: false,
    reason: "send-failed",
  });
  expect(sent.send).not.toHaveBeenCalled();
  expect(discardDraft).toHaveBeenCalledExactlyOnceWith("draft-1");
});

it("refuses the start, with the reset time in the reason, when every ready account is out of usage", () => {
  const out = conversationAvailability(
    environments(),
    withProviders(ASTRA_OUT as never, CLAUDE_OUT as never),
    ENVIRONMENT,
    { now: NOW, timestampFormat: "24-hour" },
  );
  expect(out.ok).toBe(false);
  expect(!out.ok && out.code).toBe("usage-limit");
  expect(!out.ok && out.reason).toMatch(
    /^Every connected AI account has reached its limit\. It resets .+\.$/,
  );
  // One account with usage left is enough, and a signed-out account is not one.
  expect(
    conversationAvailability(
      environments(),
      withProviders(ASTRA_OUT as never, CLAUDE_FINE as never),
      ENVIRONMENT,
      { now: NOW },
    ).ok,
  ).toBe(true);
  const signedOut = { ...CLAUDE_FINE, auth: { status: "unauthenticated" } } as never;
  const none = conversationAvailability(
    environments(),
    withProviders(ASTRA_OUT as never, signedOut),
    ENVIRONMENT,
    { now: NOW },
  );
  expect(!none.ok && none.code).toBe("usage-limit");
});

it("refuses to send into the main composer's thread when the caller is showing another thread, and sends nothing", async () => {
  using _returns = freshReturns();
  const { value, sent } = deps();
  const other = await startGuidedConversation(
    { ...input, into: "current-thread", expectThreadKey: "environment:local:side-pane-thread" },
    value,
  );
  expect(other).toEqual({ ok: false, reason: "wrong-thread" });
  expect(sent.send).not.toHaveBeenCalled();
  const same = await startGuidedConversation(
    { ...input, into: "current-thread", expectThreadKey: "draft-1" },
    value,
  );
  expect(same.ok).toBe(true);
});
