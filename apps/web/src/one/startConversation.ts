import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  MESSAGE_AGENT_CONTEXT_MAX_CHARS,
  type EnvironmentId,
  type ModelSelection,
  type ServerProvider,
  type TimestampFormat,
} from "@t3tools/contracts";
import { msg } from "gt-react";
import { useContext } from "react";
import { RegistryContext } from "@effect/atom-react";
import { useRouter } from "@tanstack/react-router";

import { useComposerDraftStore } from "~/composerDraftStore";
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

import {
  getComposerSend,
  waitForComposerSend,
  type ComposerSendBridge,
} from "./composerSendBridge";
import {
  chooseGuidedModel,
  earliestUsageReset,
  firstProviderWithUsageLeft,
  providerReady,
} from "./guidedModel";
import { rememberGuidedReturn, type GuidedReturn } from "./guidedReturn";
import { setWorkspaceMode } from "./workspaceMode";

export interface StartConversationInput {
  /** The first message exactly as the person sees it. */
  readonly visibleText: string;
  /** Notes and instructions to the model. Sent with the message, never shown to the person. */
  readonly hiddenContext: string;
  readonly returnTo?: GuidedReturn;
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
  | "send-failed";

export type GuidedConversationResult =
  | { readonly ok: true; readonly threadKey: string }
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
  /** Opens a project-less draft thread and shows it. Null when there is none to open. */
  readonly openScratchDraft: (
    environmentId: EnvironmentId,
  ) => Promise<{ readonly draftKey: string; readonly threadKey: string } | null>;
  readonly discardDraft: (draftKey: string) => void;
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
  /** Gives a draft the model it will send with. */
  readonly setDraftModel: (draftKey: string, selection: ModelSelection) => void;
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
} satisfies Record<Exclude<GuidedConversationFailure, "usage-limit">, string>;

/** The words for a failure, already translated, for a toast or an error the caller shows. */
export function guidedConversationReason(
  reason: GuidedConversationFailure,
  usage?: {
    readonly resetsAt?: string | null | undefined;
    readonly timestampFormat?: TimestampFormat | undefined;
  },
): string {
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
  if (input.hiddenContext.length > MESSAGE_AGENT_CONTEXT_MAX_CHARS) {
    return { ok: false, reason: "context-too-long" };
  }
  const sendThrough = async (bridge: ComposerSendBridge) => {
    const sent = await bridge.send({ text: input.visibleText, agentContext: input.hiddenContext });
    return sent;
  };

  if (input.into === "current-thread") {
    const bridge = deps.composer();
    if (bridge === null) return { ok: false, reason: "no-composer" };
    if (input.expectThreadKey !== undefined && bridge.threadKey !== input.expectThreadKey) {
      return { ok: false, reason: "wrong-thread" };
    }
    if (!deps.supportsAgentContext(bridge.environmentId)) {
      return { ok: false, reason: "server-too-old" };
    }
    setWorkspaceMode("chat");
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

  const environmentId = deps.scratchEnvironmentId();
  if (environmentId === null) return { ok: false, reason: "no-scratch-environment" };
  if (!deps.supportsAgentContext(environmentId)) return { ok: false, reason: "server-too-old" };
  setWorkspaceMode("chat");
  const draft = await deps.openScratchDraft(environmentId);
  if (draft === null) return { ok: false, reason: "no-scratch-environment" };
  const giveUp = (failure: GuidedConversationResult) => {
    // The draft is local and empty: take it away and go back where the person was.
    deps.discardDraft(draft.draftKey);
    if (input.returnTo) deps.navigateTo(input.returnTo.href);
    return failure;
  };
  let bridge = await deps.composerFor(draft.draftKey, COMPOSER_WAIT_MS);
  if (bridge === null) return giveUp({ ok: false, reason: "send-failed" });
  // The draft takes the default model, which may be out of usage; ask one that can answer.
  const choice = chooseGuidedModel({
    current: bridge.modelSelection,
    providers: deps.providersFor(environmentId),
    now: deps.now(),
  });
  if (choice.kind === "none") {
    return giveUp({ ok: false, reason: "usage-limit", resetsAt: choice.resetsAt });
  }
  if (choice.kind === "switch") {
    const { selection } = choice;
    deps.setDraftModel(draft.draftKey, selection);
    bridge = await deps.composerFor(
      draft.draftKey,
      COMPOSER_WAIT_MS,
      (shown) =>
        shown.modelSelection.instanceId === selection.instanceId &&
        shown.modelSelection.model === selection.model,
    );
    if (bridge === null) return giveUp({ ok: false, reason: "send-failed" });
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

function useGuidedConversationDeps(): {
  readonly deps: GuidedConversationDeps;
  readonly environments: ReadonlyArray<ConversationEnvironment>;
  readonly providers: ReadonlyMap<EnvironmentId, ReadonlyArray<ServerProvider>>;
  readonly scratchEnvironmentId: EnvironmentId | null;
  readonly timestampFormat: TimestampFormat;
} {
  const { environments } = useEnvironments();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const providers = useEnvironmentProviders();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const registry = useContext(RegistryContext);
  const handleNewThread = useNewThreadHandler();
  const router = useRouter();
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
    composer: getComposerSend,
    composerFor: waitForComposerSend,
    providersFor: (environmentId) => providers.get(environmentId) ?? [],
    now: Date.now,
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
  };
}

/** Whether a conversation can start. `reason` is already translated. */
export type ConversationAvailability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export function useConversationAvailability(): ConversationAvailability {
  const { environments, providers, scratchEnvironmentId, timestampFormat } =
    useGuidedConversationDeps();
  // A usage window that resets while the page is open frees the button; the minute clock sees it.
  const minute = useNowMinute();
  const availability = conversationAvailability(environments, providers, scratchEnvironmentId, {
    now: Date.parse(`${minute}:00.000Z`),
    timestampFormat,
  });
  return availability.ok ? { ok: true } : { ok: false, reason: availability.reason };
}

/**
 * Opens a Chat-mode thread with no project, sends `visibleText` and attaches `hiddenContext`.
 * The promise rejects with an Error whose message is the reason in the person's words.
 */
export function useStartConversation(): (input: StartConversationInput) => Promise<void> {
  const { deps, environments, providers, scratchEnvironmentId, timestampFormat } =
    useGuidedConversationDeps();
  return async (input) => {
    const availability = conversationAvailability(environments, providers, scratchEnvironmentId, {
      now: Date.now(),
      timestampFormat,
    });
    if (!availability.ok) throw new Error(availability.reason);
    const result = await startGuidedConversation(input, deps);
    if (!result.ok) {
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
