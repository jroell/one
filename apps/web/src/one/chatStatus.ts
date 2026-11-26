import { createContext, useSyncExternalStore } from "react";

/** One thing the person need not act on: a server that was slow, a workspace being prepared. */
export interface ChatStatusItem {
  readonly id: string;
  readonly kind: "working" | "notice";
  /** One plain sentence. */
  readonly title: string;
  /** The tool's own words, shown behind the sentence. */
  readonly detail: string | null;
}

const NO_ITEMS: ReadonlyArray<ChatStatusItem> = [];

/**
 * Whose header a status belongs to. Each chat view (the main thread, a side chat) provides its own
 * scope, so a side chat's items never reach the main thread's dot. Outside a view, one shared scope.
 */
export const ChatStatusScopeContext = createContext<string>("shared");

/** What each source (the conversation, the thread's sync) last published, per scope. */
const bySource = new Map<string, Map<string, ReadonlyArray<ChatStatusItem>>>();
const itemsByScope = new Map<string, ReadonlyArray<ChatStatusItem>>();
const listeners = new Set<() => void>();

function sameItems(a: ReadonlyArray<ChatStatusItem>, b: ReadonlyArray<ChatStatusItem>): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => {
      const other = b[index]!;
      return (
        item.id === other.id &&
        item.kind === other.kind &&
        item.title === other.title &&
        item.detail === other.detail
      );
    })
  );
}

/** A source publishes what is quiet right now; a header shows all sources of its scope as one dot. */
export function publishChatStatus(
  scope: string,
  source: string,
  next: ReadonlyArray<ChatStatusItem>,
): void {
  const sources = bySource.get(scope) ?? new Map<string, ReadonlyArray<ChatStatusItem>>();
  if (next.length === 0) sources.delete(source);
  else sources.set(source, next);
  if (sources.size === 0) bySource.delete(scope);
  else bySource.set(scope, sources);
  const merged = [...sources.values()].flat();
  const current = itemsByScope.get(scope) ?? NO_ITEMS;
  if (sameItems(current, merged)) return;
  if (merged.length === 0) itemsByScope.delete(scope);
  else itemsByScope.set(scope, merged);
  for (const listener of listeners) listener();
}

export function useChatStatus(scope: string): ReadonlyArray<ChatStatusItem> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => itemsByScope.get(scope) ?? NO_ITEMS,
    () => NO_ITEMS,
  );
}
