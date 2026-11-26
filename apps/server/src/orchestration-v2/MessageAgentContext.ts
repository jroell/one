import {
  isFirstPartyMessageOrigin,
  type OrchestrationMessageContext,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
} from "@t3tools/contracts";

/** Who made a message, as far as the fields that say so go. A missing field never grants trust. */
export interface MessageOrigin {
  readonly createdBy?: OrchestrationV2Actor | undefined;
  readonly creationSource?: OrchestrationV2CreationSource | undefined;
  readonly scheduledTaskId?: unknown;
  readonly senderThreadId?: unknown;
  readonly linkedSender?: unknown;
  readonly linkOrigin?: unknown;
  readonly guestMessageId?: unknown;
}

/** The same value with the app's context taken out of its message context. */
export function withoutAgentContext<
  C extends { readonly context?: OrchestrationMessageContext | undefined },
>(value: C): C {
  if (value.context?.agentContext === undefined) return value;
  const { agentContext: _agentContext, ...context } = value.context;
  return { ...value, context };
}

/**
 * Keeps the app's context on a message a person sent from this app's own client and drops it
 * from any other origin. Fails closed (see `isFirstPartyMessageOrigin`).
 */
export function withAgentContextFromFirstParty<
  C extends { readonly context?: OrchestrationMessageContext | undefined },
>(value: C, origin: MessageOrigin): C {
  return isFirstPartyMessageOrigin(origin) ? value : withoutAgentContext(value);
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
