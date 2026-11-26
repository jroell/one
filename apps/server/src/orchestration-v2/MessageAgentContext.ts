import type {
  OrchestrationMessageContext,
  OrchestrationV2Actor,
  OrchestrationV2CreationSource,
} from "@t3tools/contracts";

/** Who made a message, as far as the fields that say so go. Absent fields mean "not that". */
export interface MessageOrigin {
  readonly createdBy?: OrchestrationV2Actor | undefined;
  readonly creationSource?: OrchestrationV2CreationSource | undefined;
  readonly scheduledTaskId?: unknown;
  readonly senderThreadId?: unknown;
  readonly linkedSender?: unknown;
  readonly linkOrigin?: unknown;
  readonly guestMessageId?: unknown;
}

/**
 * Only a message a person sent from this app's own client may carry `context.agentContext`: not an
 * agent's or a tool's, not a guest's, not a scheduled task's, not one that came over a link from
 * another environment. Anything else could hide words from the person or pose as the app.
 */
function isFirstPartyMessage(origin: MessageOrigin): boolean {
  return (
    (origin.createdBy === undefined || origin.createdBy === "user") &&
    (origin.creationSource === undefined ||
      origin.creationSource === "web" ||
      origin.creationSource === "mobile") &&
    origin.scheduledTaskId === undefined &&
    origin.senderThreadId === undefined &&
    origin.linkedSender === undefined &&
    origin.linkOrigin === undefined &&
    origin.guestMessageId === undefined
  );
}

/** The same value with the app's context taken out of its message context. */
export function withoutAgentContext<
  C extends { readonly context?: OrchestrationMessageContext | undefined },
>(value: C): C {
  if (value.context?.agentContext === undefined) return value;
  const { agentContext: _agentContext, ...context } = value.context;
  return { ...value, context };
}

/** Keeps the app's context on a message from a first-party client and drops it from any other. */
export function withAgentContextFromFirstParty<
  C extends { readonly context?: OrchestrationMessageContext | undefined },
>(value: C, origin: MessageOrigin): C {
  return isFirstPartyMessage(origin) ? value : withoutAgentContext(value);
}

/**
 * An edit changes what the person wrote, never what the app attached: the context an edit sends
 * keeps the message's own app context, whatever the edit claims.
 */
export function keepingAgentContext(
  edited: OrchestrationMessageContext | undefined,
  original: OrchestrationMessageContext | undefined,
): OrchestrationMessageContext | undefined {
  if (edited === undefined) return original;
  const { agentContext: _claimed, ...rest } = edited;
  return original?.agentContext === undefined
    ? rest
    : { ...rest, agentContext: original.agentContext };
}
