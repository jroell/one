import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ScopedThreadRef,
  type ServerProvider,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { threadEnvironment } from "~/state/threads";
import {
  publishComposerSend,
  retractComposerSend,
  type ComposerSendBridge,
} from "./composerSendBridge";
import { useAskOneSheetStore } from "./askOneSheetStore";
import {
  sheetDeps,
  startGuidedConversation,
  type GuidedConversationDeps,
  type GuidedConversationResult,
  type StartConversationInput,
} from "./startConversation";
import { getWorkspaceMode, setWorkspaceMode } from "./workspaceMode";

const mocks = vi.hoisted(() => ({
  waitForThreadShell: vi.fn<(ref: unknown) => Promise<boolean>>(),
  runAtomCommand: vi.fn<(registry: unknown, command: unknown, args: unknown) => Promise<unknown>>(),
}));

vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  waitForThreadShell: mocks.waitForThreadShell as never,
}));
vi.mock(import("@t3tools/client-runtime/state/runtime"), async (original) => ({
  ...(await original()),
  runAtomCommand: mocks.runAtomCommand as never,
}));

const ENVIRONMENT = EnvironmentId.make("environment:local");
const CLAUDE: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-5-5",
};
const PROVIDER = {
  instanceId: CLAUDE.instanceId,
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-26T11:00:00.000Z",
  models: [{ slug: CLAUDE.model, name: CLAUDE.model, isCustom: false, isDefault: true }],
  slashCommands: [],
  skills: [],
} as never as ServerProvider;
const NOW = Date.parse("2026-11-26T12:00:00.000Z");
const QUESTION: StartConversationInput = { visibleText: "What is a hub?", title: "Hubs" };

/** The server commands the flow sent, by name and the thread they named. */
function commandsSent() {
  return mocks.runAtomCommand.mock.calls.map(([, command, args]) => ({
    name: command === threadEnvironment.create ? "create" : "delete",
    threadId: (args as { input: { threadId: string } }).input.threadId,
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

/** The sheet's composer, which publishes once the thread is attached, as the mounted sheet does. */
function sheetComposer(send: ComposerSendBridge["send"]) {
  const unsubscribe = useAskOneSheetStore.subscribe((state) => {
    if (state.thread === null) return;
    publishComposerSend(
      "sheet-owner",
      {
        environmentId: ENVIRONMENT,
        threadKey: scopedThreadKey(state.thread),
        isDraft: false,
        modelSelection: CLAUDE,
        send,
      },
      "sheet",
    );
  });
  return () => {
    unsubscribe();
    retractComposerSend("sheet-owner", "sheet");
  };
}

function start(generation: number): Promise<GuidedConversationResult> {
  const base = {
    scratchEnvironmentId: () => ENVIRONMENT,
    supportsAgentContext: () => true,
    threadHasAnswer: () => false,
    providersFor: () => [PROVIDER],
    now: () => NOW,
    providerName: () => "Claude",
  } as unknown as GuidedConversationDeps;
  return startGuidedConversation(
    QUESTION,
    sheetDeps({
      deps: base,
      scratch: { openScratchProject: async () => ({ id: "project-1" }) as never },
      registry: {} as never,
      providers: new Map([[ENVIRONMENT, [PROVIDER]]]),
      input: QUESTION,
      generation,
    }),
  );
}

/** The server accepts commands, and the sheet and mode are as they were, before and after a test. */
function freshFlow(): Disposable {
  const clear = () => {
    mocks.waitForThreadShell.mockReset();
    mocks.runAtomCommand.mockReset().mockResolvedValue({ _tag: "Success" });
    useAskOneSheetStore.getState().close();
    useAskOneSheetStore.getState().reset();
    setWorkspaceMode("code");
  };
  clear();
  return { [Symbol.dispose]: clear };
}

it("asking in the sheet takes the new thread away and says the question did not go through when the thread's shell never arrives", async () => {
  using _flow = freshFlow();
  mocks.waitForThreadShell.mockResolvedValue(false);
  const generation = useAskOneSheetStore.getState().begin({ title: "Hubs", question: "?" });

  const result = await start(generation);

  expect(result).toEqual({ ok: false, reason: "send-failed" });
  const sent = commandsSent();
  expect(sent.map((command) => command.name)).toEqual(["create", "delete"]);
  expect(sent[1]!.threadId).toBe(sent[0]!.threadId);
  expect(useAskOneSheetStore.getState().thread).toBeNull();
});

it("closing the sheet while its thread is still being made takes the thread away without reporting an error", async () => {
  using _flow = freshFlow();
  const shell = deferred<boolean>();
  mocks.waitForThreadShell.mockReturnValue(shell.promise);
  const generation = useAskOneSheetStore.getState().begin({ title: "Hubs", question: "?" });
  const pending = start(generation);
  await vi.waitFor(() => expect(mocks.waitForThreadShell).toHaveBeenCalled());

  useAskOneSheetStore.getState().close();
  shell.resolve(true);

  expect(await pending).toEqual({ ok: false, reason: "cancelled" });
  expect(commandsSent().map((command) => command.name)).toEqual(["create", "delete"]);
  expect(useAskOneSheetStore.getState().thread).toBeNull();
});

it("a question whose sheet was closed stops at once and leaves the next question's sheet open", async () => {
  using _flow = freshFlow();
  mocks.waitForThreadShell.mockResolvedValue(true);
  const store = useAskOneSheetStore.getState();
  const first = store.begin({ title: "Hubs", question: "First?" });
  const firstResult = start(first);
  // The first question's thread is attached and its composer never comes: the sheet is closed.
  await vi.waitFor(() => expect(useAskOneSheetStore.getState().thread).not.toBeNull());
  store.close();
  const second = store.begin({ title: "Keys", question: "Second?" });
  const secondThread = { environmentId: ENVIRONMENT, threadId: "thread-two" } as ScopedThreadRef;
  store.attach(second, secondThread);

  // It ends well before the 5 s wait for a composer, and does not touch the second sheet.
  expect(await vi.waitFor(() => firstResult, { timeout: 1_000 })).toEqual({
    ok: false,
    reason: "cancelled",
  });
  const state = useAskOneSheetStore.getState();
  expect(state.open).toBe(true);
  expect(state.thread).toEqual(secondThread);
  expect(state.title).toBe("Keys");
});

it("asking in the sheet shows Chat only while the sheet is open, and gives back the mode the workspace was in", async () => {
  using _flow = freshFlow();
  mocks.waitForThreadShell.mockResolvedValue(true);
  const send = vi.fn(async () => ({ ok: true as const, messageId: "message-1" }));
  const stopComposer = sheetComposer(send);
  try {
    setWorkspaceMode("code");
    const generation = useAskOneSheetStore.getState().begin({ title: "Hubs", question: "?" });

    const result = await start(generation);

    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(getWorkspaceMode()).toBe("chat");
    useAskOneSheetStore.getState().close();
    useAskOneSheetStore.getState().reset();
    expect(getWorkspaceMode()).toBe("code");
  } finally {
    stopComposer();
  }
});

it("closing the sheet while its question is being sent reports a cancel, not a failed question, when the send then fails", async () => {
  using _flow = freshFlow();
  mocks.waitForThreadShell.mockResolvedValue(true);
  const sending = deferred<{ ok: false; reason: "rejected" }>();
  const send = vi.fn(() => sending.promise);
  const stopComposer = sheetComposer(send);
  try {
    const generation = useAskOneSheetStore.getState().begin({ title: "Hubs", question: "?" });
    const pending = start(generation);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    useAskOneSheetStore.getState().close();
    sending.resolve({ ok: false, reason: "rejected" });

    expect(await pending).toEqual({ ok: false, reason: "cancelled" });
  } finally {
    stopComposer();
  }
});
