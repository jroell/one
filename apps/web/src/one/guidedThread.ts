import { useSyncExternalStore } from "react";

import { isSafeReturnHref } from "./guidedReturn";

/** A place a guided answer points to: a short label and an in-app path. */
export interface GuidedAction {
  readonly label: string;
  readonly href: string;
}

/** What a guided thread says about itself, kept for the session by thread. */
export interface GuidedThreadInfo {
  /** The provider that answers, as the person knows it. */
  readonly asked: string;
  /** A provider that was passed over because it was out of usage. */
  readonly skipped?: { readonly name: string; readonly resetsAt: string | null };
  /** Chips shown under the last answer. */
  readonly actions: ReadonlyArray<GuidedAction>;
}

const STORAGE_KEY = "one:guided-thread";
const MAX_ACTIONS = 3;
const MAX_LABEL = 60;

const listeners = new Set<() => void>();
let cached: {
  readonly raw: string | null;
  readonly table: Readonly<Record<string, GuidedThreadInfo>>;
} | null = null;

/** A stored entry, read back as what it must be: anything else is dropped, not trusted. */
function parseInfo(value: unknown): GuidedThreadInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.asked !== "string" || entry.asked === "") return null;
  const skipped = entry.skipped as Record<string, unknown> | undefined;
  const skippedOk =
    skipped !== undefined &&
    typeof skipped === "object" &&
    skipped !== null &&
    typeof skipped.name === "string" &&
    (skipped.resetsAt === null || typeof skipped.resetsAt === "string");
  const actions = Array.isArray(entry.actions)
    ? safeGuidedActions(
        entry.actions.flatMap((action: unknown) => {
          const item = action as Record<string, unknown> | null;
          return typeof item?.label === "string" && typeof item.href === "string"
            ? [{ label: item.label, href: item.href }]
            : [];
        }),
      )
    : [];
  return {
    asked: entry.asked,
    ...(skippedOk
      ? { skipped: { name: skipped.name as string, resetsAt: skipped.resetsAt as string | null } }
      : {}),
    actions,
  };
}

function read(): Readonly<Record<string, GuidedThreadInfo>> {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return cached?.table ?? {};
  }
  if (cached?.raw === raw) return cached.table;
  const table: Record<string, GuidedThreadInfo> = {};
  try {
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      for (const [key, value] of Object.entries(parsed)) {
        const info = parseInfo(value);
        if (info !== null) table[key] = info;
      }
    }
  } catch {
    // A table that cannot be read is no table.
  }
  cached = { raw, table };
  return table;
}

/** Keeps the first few actions with an in-app address and a label; drops the rest. */
export function safeGuidedActions(
  actions: ReadonlyArray<GuidedAction>,
): ReadonlyArray<GuidedAction> {
  return actions
    .filter((action) => action.label.trim() !== "" && isSafeReturnHref(action.href))
    .slice(0, MAX_ACTIONS)
    .map((action) => ({ label: action.label.trim().slice(0, MAX_LABEL), href: action.href }));
}

export function rememberGuidedThread(threadKey: string, info: GuidedThreadInfo): void {
  const table = { ...read(), [threadKey]: { ...info, actions: safeGuidedActions(info.actions) } };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    // Without storage the line and chips still show for this page's lifetime through the cache.
    cached = { raw: null, table };
  }
  for (const listener of listeners) listener();
}

export function useGuidedThread(threadKey: string | null): GuidedThreadInfo | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (threadKey === null ? null : (read()[threadKey] ?? null)),
    () => null,
  );
}

/** Gives a thread that was started earlier the actions the caller has now. */
export function refreshGuidedActions(
  threadKey: string,
  actions: ReadonlyArray<GuidedAction>,
): void {
  const info = read()[threadKey];
  if (info !== undefined) rememberGuidedThread(threadKey, { ...info, actions });
}
