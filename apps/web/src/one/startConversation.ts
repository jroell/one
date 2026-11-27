import {
  parseScopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  MESSAGE_AGENT_CONTEXT_MAX_CHARS,
  type EnvironmentId,
  type ModelSelection,
  type ScopedThreadRef,
  type ServerProvider,
  type TimestampFormat,
} from "@t3tools/contracts";
import { msg } from "gt-react";
import { useContext } from "react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { RegistryContext } from "@effect/atom-react";
import type { AtomRegistry } from "effect/reactivity";
import { useRouter } from "@tanstack/react-router";

import { useComposerDraftStore } from "~/composerDraftStore";
import { readThreadShell, useThreadShell, waitForThreadShell } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { newThreadId } from "~/lib/utils";
import { createScratchProjectActions } from "~/hooks/useScratchProject";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useClientSettings } from "~/hooks/useSettings";
import { m } from "~/i18n/messages";
import { formatUpcomingTimestamp } from "~/timestampFormat";
import {
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "~/state/environments";

import { useAskOneSheetStore } from "./askOneSheetStore";
import {
  getComposerSend,
  waitForComposerSend,
  type ComposerSendBridge,
} from "./composerSendBridge";
import { GuidedBridgeScopeContext } from "./guidedBridgeScope";
import {
  chooseGuidedModel,
  earliestUsageReset,
  firstProviderWithUsageLeft,
  providerReady,
} from "./guidedModel";
import { refreshGuidedActions, rememberGuidedThread, type GuidedAction } from "./guidedThread";
import {
  guidedTopicThread,
  rememberGuidedReturn,
  rememberGuidedTopic,
  type GuidedReturn,
} from "./guidedReturn";
import { setWorkspaceMode } from "./workspaceMode";

export interface StartConversationInput {
  /** The first message exactly as the person sees it. */
  readonly visibleText: string;
  /** Notes to the model. Sent with the message, never shown to the person. Absent: none. */
  readonly hiddenContext?: string;
  readonly returnTo?: GuidedReturn;
  /**
   * Names what the conversation is about. When a thread started for this key in this session still
   * exists and has an answer, it is opened instead of a new one, and nothing is sent.
   */
  readonly topicKey?: string;
  /** Places the answer points to, shown as chips under it (in-app paths only; at most three). */
  readonly actions?: ReadonlyArray<GuidedAction>;
  /** What a side sheet over Settings or Usage is titled, already translated. Absent: the question. */
  readonly title?: string;
}

export type GuidedConversationInput = StartConversationInput & {
  /** Send into the thread the main composer shows, instead of opening a new one. */
  readonly into?: "current-thread";
  /** With `into`: the thread the caller is showing; a composer on another thread is refused. */
  readonly expectThreadKey?: string | undefined;
};

export type GuidedConversationFailure =
  | "no-provider"
  | "usage-limit"
  | "no-scratch-environment"
  | "server-too-old"
  | "draft-in-the-way"
  | "context-too-long"
  | "empty-message"
  | "no-composer"
  | "wrong-thread"
  | "send-failed"
  /** The side sheet was closed or replaced while the conversation was starting; not an error. */
  | "cancelled";

export type GuidedConversationResult =
  | {
      readonly ok: true;
      readonly threadKey: string;
      /** An earlier thread for the topic was opened. */ readonly reused?: true;
    }
  | {
      readonly ok: false;
      readonly reason: GuidedConversationFailure;
      /** The server's own words, when it gave a reason for refusing the message. */
      readonly detail?: string | null;
      /** For "usage-limit": when the earliest account gets its usage back, if it says. */
      readonly resetsAt?: string | null;
    };

/** What the entry point reaches for; the hooks wire the real app in, tests wire fakes. */
export interface GuidedConversationDeps {
  readonly scratchEnvironmentId: () => EnvironmentId | null;
  readonly supportsAgentContext: (environmentId: EnvironmentId) => boolean;
  /**
   * Opens a project-less draft thread and shows it. Null when there is none to open; a `failure`
   * when there was one but it could not be shown (the thread is already taken away).
   */
  readonly openScratchDraft: (
    environmentId: EnvironmentId,
  ) => Promise<
    | { readonly draftKey: string; readonly threadKey: string }
    | { readonly failure: GuidedConversationFailure }
    | null
  >;
  readonly discardDraft: (draftKey: string) => void;
  /** Whether the thread still exists and its latest run finished with an answer. */
  readonly threadHasAnswer: (threadKey: string) => boolean;
  readonly openThread: (threadKey: string) => void;
  readonly navigateTo: (href: string) => void;
  readonly composer: () => ComposerSendBridge | null;
  readonly composerFor: (
    threadKey: string,
    timeoutMs: number,
    accept?: (bridge: ComposerSendBridge) => boolean,
  ) => Promise<ComposerSendBridge | null>;
  /** The providers of an environment, with their usage windows. */
  readonly providersFor: (environmentId: EnvironmentId) => ReadonlyArray<ServerProvider>;
  readonly now: () => number;
  /** A provider instance's name as the person knows it. */
  readonly providerName: (
    environmentId: EnvironmentId,
    instanceId: ModelSelection["instanceId"],
  ) => string;
  /** Gives a draft the model it will send with. */
  readonly setDraftModel: (draftKey: string, selection: ModelSelection) => void;
  /** Shows the conversation in Chat mode. Absent: switches the workspace to Chat. */
  readonly enterChatMode?: () => void;
  /** True once the person closed what the conversation opens in, or another one replaced it. */
  readonly cancelled?: () => boolean;
}

const COMPOSER_WAIT_MS = 5_000;

const REASONS = {
  "no-provider": msg("No AI provider is ready. Connect one in Settings, then ask again."),
  "no-scratch-environment": msg("A conversation without a project is not available here."),
  "server-too-old": msg(
    "This server is too old to carry that question. Update it, then ask again.",
  ),
  "draft-in-the-way": msg("Send or clear your draft first."),
  "context-too-long": msg("That question carries too much background to send."),
  "empty-message": msg("There is nothing to send."),
  "no-composer": msg("Open a thread you can write in first."),
  "wrong-thread": msg(
    "That thread is not the one in the main view. Open it there, then ask again.",
  ),
  "send-failed": msg("The question did not go through. Try again."),
} satisfies Record<Exclude<GuidedConversationFailure, "usage-limit" | "cancelled">, string>;

/** The words for a failure, already translated, for a toast or an error the caller shows. */
export function guidedConversationReason(
  reason: GuidedConversationFailure,
  usage?: {
    readonly resetsAt?: string | null | undefined;
    readonly timestampFormat?: TimestampFormat | undefined;
  },
): string {
  if (reason === "cancelled") return "";
  if (reason !== "usage-limit") return m(REASONS[reason]);
  if (!usage?.resetsAt) return m(msg("Every connected AI account has reached its limit."));
  const time = formatUpcomingTimestamp(usage.resetsAt, usage.timestampFormat ?? "locale");
  if (time === "") return m(msg("Every connected AI account has reached its limit."));
  return m(msg("Every connected AI account has reached its limit. It resets {time}.", { time }));
}

/**
 * Sends the person's `visibleText` with `hiddenContext` beside it, in a new project-less Chat
 * thread or (with `into`) the thread on screen. It always returns a reason instead of sending a
 * question the model could not read, and never leaves an empty thread behind.
 */
export async function startGuidedConversation(
  input: GuidedConversationInput,
  deps: GuidedConversationDeps,
): Promise<GuidedConversationResult> {
  if (input.visibleText.trim().length === 0) return { ok: false, reason: "empty-message" };
  if ((input.hiddenContext?.length ?? 0) > MESSAGE_AGENT_CONTEXT_MAX_CHARS) {
    return { ok: false, reason: "context-too-long" };
  }
  const enterChatMode = deps.enterChatMode ?? (() => setWorkspaceMode("chat"));
  const sendThrough = async (bridge: ComposerSendBridge) => {
    const sent = await bridge.send({
      text: input.visibleText,
      ...(input.hiddenContext === undefined ? {} : { agentContext: input.hiddenContext }),
    });
    return sent;
  };

  if (input.into === "current-thread") {
    const bridge = deps.composer();
    if (bridge === null) return { ok: false, reason: "no-composer" };
    if (input.expectThreadKey !== undefined && bridge.threadKey !== input.expectThreadKey) {
      return { ok: false, reason: "wrong-thread" };
    }
    if (input.hiddenContext !== undefined && !deps.supportsAgentContext(bridge.environmentId)) {
      return { ok: false, reason: "server-too-old" };
    }
    enterChatMode();
    const sent = await sendThrough(bridge);
    if (sent.ok) {
      if (input.returnTo) rememberGuidedReturn(bridge.threadKey, input.returnTo);
      return { ok: true, threadKey: bridge.threadKey };
    }
    return {
      ok: false,
      reason:
        sent.reason === "rejected" || sent.reason === "not-sent" ? "send-failed" : sent.reason,
      detail: sent.message ?? null,
    };
  }

  const earlier = input.topicKey === undefined ? null : guidedTopicThread(input.topicKey);
  if (earlier !== null && deps.threadHasAnswer(earlier)) {
    if (input.returnTo) rememberGuidedReturn(earlier, input.returnTo);
    if (input.actions) refreshGuidedActions(earlier, input.actions);
    enterChatMode();
    deps.openThread(earlier);
    return { ok: true, threadKey: earlier, reused: true };
  }
  const environmentId = deps.scratchEnvironmentId();
  if (environmentId === null) return { ok: false, reason: "no-scratch-environment" };
  if (!deps.supportsAgentContext(environmentId)) return { ok: false, reason: "server-too-old" };
  enterChatMode();
  const draft = await deps.openScratchDraft(environmentId);
  if (draft === null) return { ok: false, reason: "no-scratch-environment" };
  if ("failure" in draft) return { ok: false, reason: draft.failure };
  const giveUp = (failure: GuidedConversationResult) => {
    // The draft is empty: take it away and go back where the person was.
    deps.discardDraft(draft.draftKey);
    if (input.returnTo) deps.navigateTo(input.returnTo.href);
    return failure;
  };
  // A close or a newer question while this one was starting is the person's choice, not a failure.
  const stopped = (reason: GuidedConversationFailure): GuidedConversationResult => ({
    ok: false,
    reason: deps.cancelled?.() ? "cancelled" : reason,
  });
  if (deps.cancelled?.()) return giveUp(stopped("send-failed"));
  let bridge = await deps.composerFor(draft.draftKey, COMPOSER_WAIT_MS);
  if (bridge === null || deps.cancelled?.()) return giveUp(stopped("send-failed"));
  // The draft takes the default model, which may be out of usage; ask one that can answer.
  const choice = chooseGuidedModel({
    current: bridge.modelSelection,
    providers: deps.providersFor(environmentId),
    now: deps.now(),
  });
  if (choice.kind === "none") {
    return giveUp({ ok: false, reason: "usage-limit", resetsAt: choice.resetsAt });
  }
  let asked = deps.providerName(environmentId, bridge.modelSelection.instanceId);
  let skipped: { readonly name: string; readonly resetsAt: string | null } | undefined;
  if (choice.kind === "switch") {
    const { selection } = choice;
    asked = deps.providerName(environmentId, selection.instanceId);
    skipped = {
      name: deps.providerName(environmentId, choice.passedOver.instanceId),
      resetsAt: choice.passedOver.resetsAt,
    };
    deps.setDraftModel(draft.draftKey, selection);
    bridge = await deps.composerFor(
      draft.draftKey,
      COMPOSER_WAIT_MS,
      (shown) =>
        shown.modelSelection.instanceId === selection.instanceId &&
        shown.modelSelection.model === selection.model,
    );
    if (bridge === null || deps.cancelled?.()) return giveUp(stopped("send-failed"));
  }
  const sent = await sendThrough(bridge);
  if (!sent.ok) {
    return giveUp({
      ok: false,
      reason:
        sent.reason === "rejected" || sent.reason === "not-sent" ? "send-failed" : sent.reason,
      detail: sent.message ?? null,
    });
  }
  if (input.returnTo) rememberGuidedReturn(draft.threadKey, input.returnTo);
  if (input.topicKey !== undefined) rememberGuidedTopic(input.topicKey, draft.threadKey);
  rememberGuidedThread(draft.threadKey, {
    asked,
    ...(skipped === undefined ? {} : { skipped }),
    actions: input.actions ?? [],
  });
  return { ok: true, threadKey: draft.threadKey };
}

type ConversationEnvironment = Pick<EnvironmentPresentation, "environmentId" | "serverConfig">;

/**
 * Whether a conversation can start, and if not the reason in the person's words. A pure read of
 * the connected environments, so the same answer shows beside the control and guards the start.
 */
export function conversationAvailability(
  environments: ReadonlyArray<ConversationEnvironment>,
  providersByEnvironment: ReadonlyMap<EnvironmentId, ReadonlyArray<ServerProvider>>,
  scratchEnvironmentId: EnvironmentId | null,
  usage: { readonly now: number; readonly timestampFormat?: TimestampFormat } = { now: Date.now() },
):
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly code: GuidedConversationFailure } {
  const fail = (code: GuidedConversationFailure, resetsAt?: string | null) => ({
    ok: false as const,
    reason: guidedConversationReason(code, {
      resetsAt,
      ...(usage.timestampFormat ? { timestampFormat: usage.timestampFormat } : {}),
    }),
    code,
  });
  if (scratchEnvironmentId === null) return fail("no-scratch-environment");
  const environment = environments.find((entry) => entry.environmentId === scratchEnvironmentId);
  const config = environment?.serverConfig ?? null;
  if (config === null) return fail("no-scratch-environment");
  if (config.environment.capabilities.messageAgentContext !== true) return fail("server-too-old");
  const providers = providersByEnvironment.get(scratchEnvironmentId) ?? [];
  if (!providers.some(providerReady)) return fail("no-provider");
  if (firstProviderWithUsageLeft(providers, usage.now) === null) {
    return fail("usage-limit", earliestUsageReset(providers, usage.now));
  }
  return { ok: true };
}

/** Settings and Usage are the pages the Ask One side sheet opens over. */
function isSheetPage(pathname: string): boolean {
  return pathname === "/usage" || pathname === "/settings" || pathname.startsWith("/settings/");
}

/**
 * The entry point's dependencies for the side sheet: the thread is created empty (so the sheet can
 * show it and its composer carry the first message), the sheet's own composer sends, and giving up
 * closes the sheet and removes the empty thread. Everything is tied to the sheet opening
 * `generation`, so a flow that outlives its sheet cannot touch the next one.
 */
export function sheetDeps(input: {
  readonly deps: GuidedConversationDeps;
  readonly scratch: Pick<ReturnType<typeof createScratchProjectActions>, "openScratchProject">;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly providers: ReadonlyMap<EnvironmentId, ReadonlyArray<ServerProvider>>;
  readonly input: StartConversationInput;
  readonly generation: number;
}): GuidedConversationDeps {
  const { deps, scratch, registry, providers, generation } = input;
  const sheet = useAskOneSheetStore.getState();
  const live = () => sheet.isLive(generation);
  const titleOf = () => input.input.title ?? input.input.visibleText.slice(0, 60);
  const deleteThread = (ref: ScopedThreadRef) =>
    void runAtomCommand(
      registry,
      threadEnvironment.delete,
      { environmentId: ref.environmentId, input: { threadId: ref.threadId, onlyIfUnused: true } },
      { label: threadEnvironment.delete.label, reportFailure: false },
    );
  return {
    ...deps,
    openScratchDraft: async (environmentId) => {
      const project = await scratch.openScratchProject(environmentId);
      if (project === null) return null;
      const modelSelection = firstProviderWithUsageLeft(
        providers.get(environmentId) ?? [],
        Date.now(),
      );
      if (modelSelection === null) return null;
      const threadId = newThreadId();
      const created = await runAtomCommand(
        registry,
        threadEnvironment.create,
        {
          environmentId,
          input: {
            threadId,
            projectId: project.id,
            title: titleOf().trim() || m(msg("Ask One")),
            modelSelection,
            runtimeMode: "approval-required",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
          },
        },
        { label: threadEnvironment.create.label, reportFailure: false },
      );
      if (created._tag === "Failure") return null;
      const threadRef = scopeThreadRef(environmentId, threadId);
      // The thread exists on the server from here: every way out below takes it away again.
      if (!live()) {
        deleteThread(threadRef);
        return { failure: "cancelled" };
      }
      if (!(await waitForThreadShell(threadRef))) {
        deleteThread(threadRef);
        return { failure: live() ? "send-failed" : "cancelled" };
      }
      if (!live()) {
        deleteThread(threadRef);
        return { failure: "cancelled" };
      }
      sheet.attach(generation, threadRef);
      const threadKey = scopedThreadKey(threadRef);
      return { draftKey: threadKey, threadKey };
    },
    discardDraft: (threadKey) => {
      sheet.close(generation);
      const ref = parseScopedThreadKey(threadKey);
      if (ref !== null) deleteThread(ref);
    },
    // The page under the sheet is already where the person was; going back is closing.
    navigateTo: () => sheet.close(generation),
    openThread: (threadKey) => {
      const ref = parseScopedThreadKey(threadKey);
      if (ref !== null && live()) sheet.show({ title: titleOf(), thread: ref });
    },
    composer: () => getComposerSend("sheet"),
    composerFor: (threadKey, timeoutMs, accept) => {
      // A sheet that was closed has no composer to wait for.
      let stopWatching = () => {};
      const closed = new Promise<null>((resolve) => {
        if (!live()) return resolve(null);
        stopWatching = useAskOneSheetStore.subscribe(() => {
          if (!live()) resolve(null);
        });
      });
      return Promise.race([
        waitForComposerSend(threadKey, timeoutMs, accept, "sheet"),
        closed,
      ]).finally(stopWatching);
    },
    setDraftModel: (threadKey, selection) => {
      const ref = parseScopedThreadKey(threadKey);
      if (ref !== null) useComposerDraftStore.getState().setModelSelection(ref, selection);
    },
    enterChatMode: sheet.enterChatMode,
    cancelled: () => !live(),
  };
}

function useGuidedConversationDeps(): {
  readonly deps: GuidedConversationDeps;
  readonly environments: ReadonlyArray<ConversationEnvironment>;
  readonly providers: ReadonlyMap<EnvironmentId, ReadonlyArray<ServerProvider>>;
  readonly scratchEnvironmentId: EnvironmentId | null;
  readonly timestampFormat: TimestampFormat;
  /** The same entry point's dependencies, for a conversation shown in the side sheet. */
  readonly openSheetDeps: (
    input: StartConversationInput,
    generation: number,
  ) => GuidedConversationDeps;
  /** Whether the page on screen is one the sheet opens over (Settings, Usage). */
  readonly onSheetPage: () => boolean;
} {
  const { environments } = useEnvironments();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const providers = useEnvironmentProviders();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const registry = useContext(RegistryContext);
  const handleNewThread = useNewThreadHandler();
  const router = useRouter();
  const bridgeScope = useContext(GuidedBridgeScopeContext);
  const scratch = createScratchProjectActions({
    environments: () => environments,
    primaryEnvironmentId: () => primaryEnvironmentId,
    registry,
    handleNewThread,
  });
  const supportsAgentContext = (environmentId: EnvironmentId) =>
    environments.find((entry) => entry.environmentId === environmentId)?.serverConfig?.environment
      .capabilities.messageAgentContext === true;
  const deps: GuidedConversationDeps = {
    scratchEnvironmentId: () => scratch.scratchEnvironmentId(null),
    supportsAgentContext,
    openScratchDraft: async (environmentId) => {
      const project = await scratch.openScratchProject(environmentId);
      if (project === null) return null;
      const started = await handleNewThread(scopeProjectRef(project.environmentId, project.id));
      if (started === null) return null;
      return {
        draftKey: started.draftId,
        threadKey: scopedThreadKey(scopeThreadRef(project.environmentId, started.threadId)),
      };
    },
    discardDraft: (draftKey) =>
      useComposerDraftStore
        .getState()
        .clearDraftThread(
          draftKey as Parameters<
            ReturnType<typeof useComposerDraftStore.getState>["clearDraftThread"]
          >[0],
        ),
    navigateTo: (href) => void router.navigate({ href }),
    threadHasAnswer: (threadKey) => {
      const ref = parseScopedThreadKey(threadKey);
      return ref !== null && readThreadShell(ref)?.latestRun?.status === "completed";
    },
    openThread: (threadKey) => {
      const ref = parseScopedThreadKey(threadKey);
      if (ref === null) return;
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: ref.environmentId, threadId: ref.threadId },
      });
    },
    composer: () => getComposerSend(bridgeScope),
    composerFor: (threadKey, timeoutMs, accept) =>
      waitForComposerSend(threadKey, timeoutMs, accept, bridgeScope),
    providersFor: (environmentId) => providers.get(environmentId) ?? [],
    now: Date.now,
    providerName: (environmentId, instanceId) => {
      const provider = providers
        .get(environmentId)
        ?.find((entry) => entry.instanceId === instanceId);
      return provider === undefined ? instanceId : resolveProviderInstanceDisplayName(provider);
    },
    setDraftModel: (draftKey, selection) =>
      useComposerDraftStore
        .getState()
        .setModelSelection(
          draftKey as Parameters<
            ReturnType<typeof useComposerDraftStore.getState>["setModelSelection"]
          >[0],
          selection,
        ),
  };
  return {
    deps,
    environments,
    providers,
    scratchEnvironmentId: scratch.scratchEnvironmentId(null),
    timestampFormat,
    openSheetDeps: (input, generation) =>
      sheetDeps({ deps, scratch, registry, providers, input, generation }),
    onSheetPage: () => isSheetPage(router.state.location.pathname),
  };
}

/**
 * Whether a conversation can start. `reason` is already translated. `reopens` is set when asking
 * would open the topic's earlier thread instead of a new one, so the button can say "Continue".
 */
export type ConversationAvailability =
  | { readonly ok: true; readonly reopens?: true }
  | { readonly ok: false; readonly reason: string };

/** Whether asking about this topic reopens an earlier thread that has an answer, which needs no provider. */
function useTopicThreadReusable(topicKey: string | undefined): boolean {
  const threadKey = topicKey === undefined ? null : guidedTopicThread(topicKey);
  const shell = useThreadShell(threadKey === null ? null : parseScopedThreadKey(threadKey));
  return shell?.latestRun?.status === "completed";
}

export function useConversationAvailability(topicKey?: string): ConversationAvailability {
  const reusable = useTopicThreadReusable(topicKey);
  const { environments, providers, scratchEnvironmentId, timestampFormat } =
    useGuidedConversationDeps();
  // A usage window that resets while the page is open frees the button; the minute clock sees it.
  const minute = useNowMinute();
  const availability = conversationAvailability(environments, providers, scratchEnvironmentId, {
    now: Date.parse(`${minute}:00.000Z`),
    timestampFormat,
  });
  if (reusable) return { ok: true, reopens: true };
  return availability.ok ? { ok: true } : { ok: false, reason: availability.reason };
}

/**
 * Opens a Chat-mode thread with no project, sends `visibleText` and attaches `hiddenContext`.
 * The promise rejects with an Error whose message is the reason in the person's words.
 */
export function useStartConversation(): (input: StartConversationInput) => Promise<void> {
  const {
    deps,
    environments,
    providers,
    scratchEnvironmentId,
    timestampFormat,
    openSheetDeps,
    onSheetPage,
  } = useGuidedConversationDeps();
  return async (input) => {
    const earlier = input.topicKey === undefined ? null : guidedTopicThread(input.topicKey);
    const reusable = earlier !== null && deps.threadHasAnswer(earlier);
    const availability = conversationAvailability(environments, providers, scratchEnvironmentId, {
      now: Date.now(),
      timestampFormat,
    });
    if (!availability.ok && !reusable) throw new Error(availability.reason);
    // Over Settings or Usage the answer opens beside the page, with the question showing at once;
    // anywhere else it is its own thread.
    const inSheet = onSheetPage();
    const generation = inSheet
      ? useAskOneSheetStore.getState().begin({
          title: input.title ?? input.visibleText.slice(0, 60),
          question: input.visibleText,
        })
      : 0;
    const result = await startGuidedConversation(
      input,
      inSheet ? openSheetDeps(input, generation) : deps,
    );
    if (!result.ok) {
      // The person closed the sheet, or asked something else, while this started: nothing to report.
      if (result.reason === "cancelled") return;
      if (inSheet) useAskOneSheetStore.getState().close(generation);
      throw new Error(
        result.detail ??
          guidedConversationReason(result.reason, { resetsAt: result.resetsAt, timestampFormat }),
      );
    }
  };
}

/** For callers that send into the thread on screen and show a failure themselves. */
export function useSendGuidedMessage(): (
  input: StartConversationInput & { readonly expectThreadKey?: string | undefined },
) => Promise<GuidedConversationResult> {
  const { deps } = useGuidedConversationDeps();
  return (input) => startGuidedConversation({ ...input, into: "current-thread" }, deps);
}
