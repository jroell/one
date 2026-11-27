import { exhaustedUsageWindow } from "@t3tools/shared/usageLimits";
import {
  isUnconfiguredDefaultInstanceEnabled,
  PROVIDER_DISPLAY_NAMES,
  providerInstanceConfigEnabledFlag,
  resolveProviderInstanceEnabled,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";

export type ProviderFix =
  | { readonly kind: "none" }
  | { readonly kind: "open-providers" }
  | {
      readonly kind: "turn-on";
      readonly instanceId: ProviderInstanceId;
      readonly instance: ProviderInstanceConfig;
      readonly name: string;
    };

/**
 * Nothing when a provider is ready with usage left; an instance the person switched off, to switch on in place;
 * else the Providers page. The server lists a disabled provider as not installed, sign-in
 * unknown, so the saved instances (as on the Providers page) say which one is off.
 */
export function chooseProviderFix(input: {
  readonly instances: Readonly<Record<string, ProviderInstanceConfig>> | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly now: number;
}): ProviderFix {
  // A provider with no usage left does not make a conversation possible, so it does not count.
  const ready = input.providers.some(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      provider.status === "ready" &&
      provider.auth.status !== "unauthenticated" &&
      exhaustedUsageWindow(provider, input.now) === undefined,
  );
  if (ready) return { kind: "none" };
  const offInstances = Object.entries(input.instances ?? {}).filter(
    ([, instance]) => !resolveProviderInstanceEnabled(instance),
  );
  // The providers One enables by default (Codex, Claude) before any added or dev instance.
  const off =
    offInstances.find(([id]) => isUnconfiguredDefaultInstanceEnabled(id as ProviderInstanceId)) ??
    offInstances[0];
  if (off === undefined) return { kind: "open-providers" };
  const [rawId, instance] = off;
  const instanceId = rawId as ProviderInstanceId;
  const listed = input.providers.find((provider) => provider.instanceId === instanceId);
  return {
    kind: "turn-on",
    instanceId,
    instance,
    name:
      instance.displayName?.trim() ||
      listed?.displayName?.trim() ||
      PROVIDER_DISPLAY_NAMES[instance.driver] ||
      String(instance.driver),
  };
}

/**
 * The instance with both flags on. `resolveProviderInstanceEnabled` is false while either the
 * top-level `enabled` or the one inside `config` says false, so setting only one does nothing.
 */
export function withProviderInstanceEnabled(
  instance: ProviderInstanceConfig,
): ProviderInstanceConfig {
  return {
    ...instance,
    enabled: true,
    ...(providerInstanceConfigEnabledFlag(instance.config) === false
      ? { config: { ...(instance.config as Record<string, unknown>), enabled: true } }
      : {}),
  };
}
