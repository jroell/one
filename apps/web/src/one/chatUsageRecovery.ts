import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import type { ModelSelection, ServerProvider } from "@t3tools/contracts";

import { getTriggerDisplayModelName } from "~/components/chat/providerIconUtils";

import { firstProviderWithUsageLeft } from "./guidedModel";

export interface UsageLimitRecovery {
  /** The model that could not answer, as the person knows it ("6 Astra"). */
  readonly failedModel: string;
  /** When its usage returns, if the provider said. */
  readonly resetsAt: string | null;
  /** A provider that can answer now, or null when none can. */
  readonly alternative: {
    readonly selection: ModelSelection;
    readonly providerName: string;
  } | null;
}

/**
 * What a Chat thread says when its run stopped on a usage limit: the model that was out, and the
 * first other ready provider with usage left to try instead. The failed run's own provider is
 * never offered back.
 */
export function deriveUsageLimitRecovery(input: {
  readonly failedSelection: ModelSelection;
  readonly resetsAt: string | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly now: number;
}): UsageLimitRecovery {
  const { failedSelection, providers } = input;
  const failedProvider = providers.find((entry) => entry.instanceId === failedSelection.instanceId);
  const failedCatalogModel = failedProvider?.models.find(
    (model) => model.slug === failedSelection.model,
  );
  // The name the composer's model button shows, so the message and the button agree.
  const failedModel =
    failedCatalogModel === undefined
      ? failedSelection.model
      : getTriggerDisplayModelName(failedCatalogModel, failedProvider?.driver);
  const selection = firstProviderWithUsageLeft(providers, input.now, failedSelection.instanceId);
  const provider = providers.find((entry) => entry.instanceId === selection?.instanceId);
  return {
    failedModel,
    resetsAt: input.resetsAt,
    alternative:
      selection !== null && provider !== undefined
        ? { selection, providerName: resolveProviderInstanceDisplayName(provider) }
        : null,
  };
}
