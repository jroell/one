import { useState } from "react";

function bump(counts: ReadonlyMap<string, number>, key: string, by: 1 | -1) {
  const next = new Map(counts);
  const count = (next.get(key) ?? 0) + by;
  if (count > 0) next.set(key, count);
  else next.delete(key);
  return next;
}

/** Whether any of the given environments still has a refresh that has not settled. */
export function anyRefreshPending(
  pending: ReadonlyMap<string, number>,
  environmentIds: readonly string[],
): boolean {
  return environmentIds.some((id) => (pending.get(id) ?? 0) > 0);
}

/**
 * The refreshes still in flight, counted per environment. Each call is tracked from its own start
 * to its own end, so one environment settling never clears another that is still pending, and a
 * caller reads progress for just the environments currently selected.
 */
export function usePendingRefreshes() {
  const [pending, setPending] = useState<ReadonlyMap<string, number>>(() => new Map());
  const track = <Result>(environmentId: string, request: Promise<Result>): Promise<Result> => {
    setPending((counts) => bump(counts, environmentId, 1));
    return request.finally(() => setPending((counts) => bump(counts, environmentId, -1)));
  };
  return [pending, track] as const;
}
