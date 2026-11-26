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
