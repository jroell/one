import { useSyncExternalStore } from "react";

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
/** What each source (the conversation, the thread's sync) last published, in source order. */
const bySource = new Map<string, ReadonlyArray<ChatStatusItem>>();
let items: ReadonlyArray<ChatStatusItem> = NO_ITEMS;
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

/** A source publishes what is quiet right now; the header shows all sources as one dot. */
export function publishChatStatus(source: string, next: ReadonlyArray<ChatStatusItem>): void {
  if (next.length === 0) bySource.delete(source);
  else bySource.set(source, next);
  const merged = [...bySource.values()].flat();
  if (sameItems(items, merged)) return;
  items = merged.length === 0 ? NO_ITEMS : merged;
  for (const listener of listeners) listener();
}

export function useChatStatus(): ReadonlyArray<ChatStatusItem> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => items,
    () => NO_ITEMS,
  );
}
