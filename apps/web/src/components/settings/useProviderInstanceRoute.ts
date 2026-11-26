import type { ProviderInstanceId } from "@t3tools/contracts";
import { useBlocker, useNavigate, useSearch } from "@tanstack/react-router";

import { commitFocusedField } from "./providerInstanceFocus";

/**
 * Which provider the address names, and the way to open one or go back to the list. A provider is
 * a page of its own at `?instanceId=`, so Back and Forward move between the list and a provider.
 */
export function useProviderInstanceRoute() {
  const navigate = useNavigate();
  const instanceId = useSearch({
    strict: false,
    select: (search: { readonly instanceId?: ProviderInstanceId }) => search.instanceId,
  });
  // Any move off a provider, browser Back included, first commits the field being typed in: the
  // field commits on blur, and removing it from the page would skip that.
  useBlocker({
    shouldBlockFn: () => {
      commitFocusedField();
      return false;
    },
    enableBeforeUnload: false,
  });
  const onSelectInstance = (next: ProviderInstanceId | null) =>
    void navigate({
      to: "/settings/providers",
      search: (previous) => {
        const { instanceId: _current, ...rest } = previous;
        return next === null ? rest : { ...rest, instanceId: next };
      },
      resetScroll: true,
    });
  return { instanceId, onSelectInstance };
}
