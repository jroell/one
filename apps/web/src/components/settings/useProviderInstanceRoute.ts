import type { ProviderInstanceId } from "@t3tools/contracts";
import { useBlocker, useLocation, useNavigate, useSearch } from "@tanstack/react-router";

import { commitFocusedField } from "./providerInstanceFocus";
import { SETTINGS_PAGE_TRANSITION } from "./settingsPageTransition";

/** What a history entry of the list remembers: the provider it was left through. */
interface ProviderListEntryState {
  readonly providerFocusRow?: string;
}

/**
 * Which provider the address names, and the way to open one or go back to the list. A provider is
 * a page of its own at `?instanceId=`, so Back and Forward move between the list and a provider.
 *
 * The list entry of the history remembers which provider it was left through, so every return to it
 * (the breadcrumb, Back, Back again after Forward) can focus that row.
 */
export function useProviderInstanceRoute() {
  const navigate = useNavigate();
  const instanceId = useSearch({
    strict: false,
    select: (search: { readonly instanceId?: ProviderInstanceId }) => search.instanceId,
  });
  const returnFocusRow = useLocation({
    select: (location) => (location.state as ProviderListEntryState).providerFocusRow,
  });
  // A move that removes the provider's page (to the list, to another provider, or off Settings
  // pages) first commits the field being typed in: the field commits on blur, and removing it from
  // the page would skip that. A move that keeps the same provider leaves focus alone.
  useBlocker({
    shouldBlockFn: ({ current, next }) => {
      const currentInstance = (current.search as { instanceId?: string }).instanceId;
      const nextInstance = (next.search as { instanceId?: string }).instanceId;
      if (current.pathname !== next.pathname || currentInstance !== nextInstance) {
        commitFocusedField();
      }
      return false;
    },
    enableBeforeUnload: false,
  });
  const onSelectInstance = async (next: ProviderInstanceId | null) => {
    const search = (previous: object, instance: ProviderInstanceId | null) => {
      const { instanceId: _current, ...rest } = previous as { instanceId?: string };
      return instance === null ? rest : { ...rest, instanceId: instance };
    };
    // Opening: the list entry being left keeps the provider's id, then the provider is pushed.
    // Closing: the new list entry carries the id of the provider just left.
    if (next !== null) {
      await navigate({
        to: "/settings/providers",
        search: (previous) => search(previous, null),
        state: { providerFocusRow: next } as never,
        replace: true,
        resetScroll: false,
      });
    }
    await navigate({
      to: "/settings/providers",
      search: (previous) => search(previous, next),
      ...(next === null && instanceId !== undefined
        ? { state: { providerFocusRow: instanceId } as never }
        : {}),
      resetScroll: true,
      viewTransition: SETTINGS_PAGE_TRANSITION,
    });
  };
  return { instanceId, onSelectInstance, returnFocusRow };
}
