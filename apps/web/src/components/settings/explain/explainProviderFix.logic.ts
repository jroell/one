import type { ServerProvider } from "@t3tools/contracts";

export type ProviderFix =
  | { readonly kind: "none" }
  | { readonly kind: "open-providers" }
  | { readonly kind: "turn-on"; readonly provider: ServerProvider };

/**
 * What fixes "no AI provider is ready": nothing when one is ready (the reason is something else),
 * switching on a provider that is installed and signed in but off, or adding one on the Providers page.
 */
export function chooseProviderFix(providers: ReadonlyArray<ServerProvider>): ProviderFix {
  const ready = providers.some(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      provider.status === "ready" &&
      provider.auth.status !== "unauthenticated",
  );
  if (ready) return { kind: "none" };
  const off = providers.find(
    (provider) =>
      !provider.enabled && provider.installed && provider.auth.status !== "unauthenticated",
  );
  return off === undefined ? { kind: "open-providers" } : { kind: "turn-on", provider: off };
}
