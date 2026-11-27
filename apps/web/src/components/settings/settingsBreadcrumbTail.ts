import { useEffect, useSyncExternalStore } from "react";

import type { ExplainTopicId } from "./explain/explainTypes";

/** A page opened inside a settings section, such as one provider: its name and the way back. */
export interface SettingsBreadcrumbTail {
  readonly label: string;
  /** The one line under the page's title while this sub-page is open. */
  readonly purpose: string;
  /** The page-level "What is this?" for this sub-page, such as the Codex provider page. */
  readonly explain?: ExplainTopicId;
  readonly onUp: () => void;
}

let current: SettingsBreadcrumbTail | null = null;
const listeners = new Set<() => void>();

function publish(next: SettingsBreadcrumbTail | null) {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The sub-page the open section is showing, for the header's trail; null on the section's list. */
export function useSettingsBreadcrumbTail(): SettingsBreadcrumbTail | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/**
 * Registers the sub-page this one shows for the header's trail ("Settings / Providers / Codex")
 * and takes it back when the page changes or unmounts. The page's title and purpose line follow it.
 * `onUp` returns to the section's list.
 */
export function useRegisterSettingsBreadcrumbTail(
  label: string | null,
  purpose: string,
  onUp: () => void,
  explain?: ExplainTopicId,
) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds a registry entry in the header's store until this page unmounts
  useEffect(() => {
    if (label === null) return;
    publish({ label, purpose, onUp, ...(explain ? { explain } : {}) });
    return () => publish(null);
  }, [label, purpose, onUp, explain]);
}
