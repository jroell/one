import type { ProviderApprovalDecision, RuntimeRequestId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

/**
 * The answer a person has just given a waiting approval, by whatever way they gave it: the card's
 * button or a keyboard chord. The card reads it to show the pressed button, and keeps it to name
 * the outcome while it leaves.
 */
const decisions = new Map<RuntimeRequestId, ProviderApprovalDecision>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function noteApprovalDecision(
  requestId: RuntimeRequestId,
  decision: ProviderApprovalDecision,
): void {
  decisions.set(requestId, decision);
  emit();
}

export function peekApprovalDecision(
  requestId: RuntimeRequestId,
): ProviderApprovalDecision | undefined {
  return decisions.get(requestId);
}

export function clearApprovalDecision(requestId: RuntimeRequestId): void {
  if (decisions.delete(requestId)) emit();
}

/** Drops every recorded answer whose request is no longer waiting or leaving. */
export function pruneApprovalDecisions(keep: (requestId: RuntimeRequestId) => boolean): void {
  let removed = false;
  for (const requestId of decisions.keys()) {
    if (!keep(requestId) && decisions.delete(requestId)) removed = true;
  }
  if (removed) emit();
}

const failed = (result: unknown): boolean =>
  typeof result === "object" &&
  result !== null &&
  (result as { _tag?: unknown })._tag === "Failure";

/**
 * Records the answer, sends it, and takes the record back when the send fails. A refused answer
 * comes back as a failure result, not a rejection, so both end the record: a card that stays
 * waiting must not read as pressed.
 */
export async function answerApproval(
  requestId: RuntimeRequestId,
  decision: ProviderApprovalDecision,
  respond: (requestId: RuntimeRequestId, decision: ProviderApprovalDecision) => Promise<unknown>,
): Promise<void> {
  noteApprovalDecision(requestId, decision);
  try {
    if (failed(await respond(requestId, decision))) clearApprovalDecision(requestId);
  } catch {
    clearApprovalDecision(requestId);
  }
}

export function useApprovalDecision(
  requestId: RuntimeRequestId,
): ProviderApprovalDecision | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => decisions.get(requestId),
  );
}
