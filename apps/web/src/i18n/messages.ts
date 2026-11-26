import { decodeOptions, getReactI18nCache, gtFallback, type useMessages } from "gt-react";

import { DEFAULT_LOCALE } from "./locales";

export type MessageResolver = ReturnType<typeof useMessages>;

let activeLocale = DEFAULT_LOCALE;

// Formatting a message validates its locale through Intl each time, and a screen resolves the same
// few messages on every render. A result depends only on the locale, the message and its variables,
// so plain ones are kept (bounded; a locale switch clears them).
const MAX_RESOLVED = 2000;
const resolved = new Map<string, string>();

/** The runtime calls this once the locale's catalog is in GT's cache. */
export function setActiveLocale(locale: string): void {
  activeLocale = locale;
  resolved.clear();
}

/** The UI language for Intl formatting outside React; components use GT's `useLocale()`. */
export function getActiveLocale(): string {
  return activeLocale;
}

function resolvedKey(message: string, variables: Record<string, unknown>): string | null {
  let key = `${activeLocale}\0${message}`;
  for (const name of Object.keys(variables).toSorted()) {
    const value = variables[name];
    if (value !== null && value !== undefined && typeof value === "object") return null;
    if (typeof value === "function") return null;
    key += `\0${name}=${String(value)}`;
  }
  return key;
}

function resolve(message: string, variables: Parameters<MessageResolver>[1] = {}): string {
  const key = resolvedKey(message, variables);
  const kept = key === null ? undefined : resolved.get(key);
  if (kept !== undefined) return kept;
  const text = format(message, variables);
  if (key !== null) {
    if (resolved.size >= MAX_RESOLVED) resolved.clear();
    resolved.set(key, text);
  }
  return text;
}

function format(message: string, variables: Parameters<MessageResolver>[1] = {}): string {
  const decoded = decodeOptions(message);
  const options = typeof decoded?.$_source === "string" ? decoded : variables;
  const source = typeof decoded?.$_source === "string" ? decoded.$_source : message;
  // English never touches GT, so this also runs in unit tests where GT was never initialized.
  const target =
    activeLocale === DEFAULT_LOCALE
      ? undefined
      : getReactI18nCache().lookupTranslation(activeLocale, source, { ...options, $format: "ICU" });
  // Untranslated text is English, so it takes English plural rules.
  return typeof target === "string"
    ? gtFallback(target, { ...options, $locale: activeLocale, $_fallback: source })
    : gtFallback(source, { ...options, $locale: DEFAULT_LOCALE });
}

/**
 * Resolves a `msg()` string in the current UI language, at call time. For code outside React
 * (toasts, stores, announcements). Components use `useMessages()` so they re-render on a switch.
 */
export const m = ((message, variables) =>
  typeof message === "string" ? resolve(message, variables) : message) as MessageResolver;
