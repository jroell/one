import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import { exhaustedUsageWindow } from "@t3tools/shared/usageLimits";

import { getDefaultProviderInstanceModel } from "~/providerInstances";

/** The same test the entry point has always used for a provider that can take a message. */
export function providerReady(provider: ServerProvider): boolean {
  return (
    provider.enabled &&
    provider.installed &&
    provider.status === "ready" &&
    provider.auth.status !== "unauthenticated"
  );
}

export type GuidedModelChoice =
  /** The draft's model can answer; send as it is. */
  | { readonly kind: "keep" }
  /** The draft's provider is out of usage; send with this model, which can answer now. */
  | { readonly kind: "switch"; readonly selection: ModelSelection }
  /** Every ready provider is out of usage. `resetsAt` is the earliest reset, when one is known. */
  | { readonly kind: "none"; readonly resetsAt: string | null };

/** The first ready provider whose default model has usage left, in the order the server lists them. */
export function firstProviderWithUsageLeft(
  providers: ReadonlyArray<ServerProvider>,
  now: number,
  skip?: ModelSelection["instanceId"],
): ModelSelection | null {
  for (const provider of providers) {
    if (provider.instanceId === skip || !providerReady(provider)) continue;
    const model = getDefaultProviderInstanceModel(providers, provider.instanceId);
    if (model === undefined) continue;
    if (exhaustedUsageWindow(provider, now, model) === undefined) {
      return { instanceId: provider.instanceId, model };
    }
  }
  return null;
}

/** The earliest time an exhausted ready provider gets its usage back, or null when none says. */
export function earliestUsageReset(
  providers: ReadonlyArray<ServerProvider>,
  now: number,
): string | null {
  let best: { readonly at: string; readonly ms: number } | null = null;
  for (const provider of providers) {
    if (!providerReady(provider)) continue;
    const model = getDefaultProviderInstanceModel(providers, provider.instanceId);
    const window = exhaustedUsageWindow(provider, now, model);
    const ms = window?.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
    if (window?.resetsAt && Number.isFinite(ms) && (best === null || ms < best.ms)) {
      best = { at: window.resetsAt, ms };
    }
  }
  return best?.at ?? null;
}

/**
 * Picks the model a guided conversation sends with. The draft's own model stays unless its
 * provider has an exhausted usage window (`exhaustedUsageWindow`, the test new threads already
 * use); then the first ready provider with usage left answers instead.
 */
export function chooseGuidedModel(input: {
  readonly current: ModelSelection;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly now: number;
}): GuidedModelChoice {
  const provider = input.providers.find((entry) => entry.instanceId === input.current.instanceId);
  if (provider === undefined || !exhaustedUsageWindow(provider, input.now, input.current.model)) {
    return { kind: "keep" };
  }
  const selection = firstProviderWithUsageLeft(input.providers, input.now, provider.instanceId);
  if (selection !== null) return { kind: "switch", selection };
  return { kind: "none", resetsAt: earliestUsageReset(input.providers, input.now) };
}
