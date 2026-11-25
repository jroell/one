import { useSyncExternalStore } from "react";

type Counts = ReadonlyMap<string, number>;

/**
 * Pending refreshes live at module level, not in a component: the client runtime keeps a refresh
 * running after the Usage page closes, so a reopened page must still see it as pending.
 */
let counts: Counts = new Map();
const listeners = new Set<() => void>();

function bump(key: string, by: 1 | -1) {
  const next = new Map(counts);
  const count = (next.get(key) ?? 0) + by;
  if (count > 0) next.set(key, count);
  else next.delete(key);
  counts = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Whether any of the given environments still has a refresh that has not settled. */
export function anyRefreshPending(pending: Counts, environmentIds: readonly string[]): boolean {
  return environmentIds.some((id) => (pending.get(id) ?? 0) > 0);
}

/** Tracks one environment's refresh from its own start to its own end. */
function trackRefresh<Result>(environmentId: string, request: Promise<Result>): Promise<Result> {
  bump(environmentId, 1);
  return request.finally(() => bump(environmentId, -1));
}

/**
 * The refreshes still in flight, counted per environment. A caller reads progress for just the
 * environments currently selected, and the count survives the page closing and reopening.
 */
export function usePendingRefreshes() {
  const pending = useSyncExternalStore(
    subscribe,
    () => counts,
    () => counts,
  );
  return [pending, trackRefresh] as const;
}
