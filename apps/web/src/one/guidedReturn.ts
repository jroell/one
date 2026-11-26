import { useSyncExternalStore } from "react";

/** Where a guided conversation was opened from, so the Chat header can offer the way back. */
export interface GuidedReturn {
  readonly label: string;
  readonly href: string;
}

const STORAGE_KEY = "one:guided-return";
const MAX_LABEL = 80;

type Table = Readonly<Record<string, GuidedReturn>>;

const listeners = new Set<() => void>();
let cached: { readonly raw: string | null; readonly table: Table } | null = null;

/** Only a path inside this app: no other site, no script, no protocol-relative address. */
export function isSafeReturnHref(href: string): boolean {
  return /^\/(?![/\\])[^\s]*$/.test(href);
}

function read(): Table {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return cached?.table ?? {};
  }
  if (cached?.raw === raw) return cached.table;
  let table: Table = {};
  try {
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const entries = Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) => {
        const target = value as Partial<GuidedReturn> | null;
        return typeof target?.label === "string" &&
          typeof target.href === "string" &&
          isSafeReturnHref(target.href)
          ? [[key, { label: target.label, href: target.href }] as const]
          : [];
      });
      table = Object.fromEntries(entries);
    }
  } catch {
    table = {};
  }
  cached = { raw, table };
  return table;
}

function write(table: Table) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    // Without storage the control still shows for this page's lifetime through the cache.
    cached = { raw: null, table };
  }
  for (const listener of listeners) listener();
}

/** Remembers where a thread's guided conversation came from. An address outside the app is refused. */
export function rememberGuidedReturn(threadKey: string, target: GuidedReturn): boolean {
  if (!isSafeReturnHref(target.href)) return false;
  write({
    ...read(),
    [threadKey]: { label: target.label.trim().slice(0, MAX_LABEL), href: target.href },
  });
  return true;
}

export function clearGuidedReturn(threadKey: string): void {
  const { [threadKey]: _gone, ...rest } = read();
  write(rest);
}

export function useGuidedReturn(threadKey: string): GuidedReturn | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => read()[threadKey] ?? null,
    () => null,
  );
}
