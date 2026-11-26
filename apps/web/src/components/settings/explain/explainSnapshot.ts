import type { ServerProvider } from "@t3tools/contracts";
import type { MessageResolver } from "../../../i18n/messages";
import { getProviderStatusKey, providerAuthLabel, providerPlanLabel } from "../providerStatus";
import type { SetupSnapshot } from "./explainTypes";

/**
 * Anything shaped like a secret or an address that identifies a person is replaced before it can
 * reach the model: emails, `Bearer` values, `key=value` pairs, URLs with credentials, well-known
 * key prefixes, and any long unbroken run of letters and digits. The facts are names and states, so
 * nothing of value is lost; a display name a person pasted a key into is the case this is for.
 */
const SECRET_SHAPES: ReadonlyArray<RegExp> = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/g,
  // An authorization header: whatever follows the scheme is the credential.
  /\b(?:proxy-)?authorization\s*[:=]\s*(?:\w+\s+)?\S+/gi,
  /\b(?:bearer|basic|digest|token)\s+\S+/gi,
  /\b[\w-]*(?:key|token|secret|password|passwd|pwd|pw|pass|auth)[\w-]*\s*[:=]\s*\S+/gi,
  // A home directory carries the user name: /Users/<name>, /home/<name>, C:\\Users\\<name>.
  /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s/\\]+/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@\S+/gi,
  /\b(?:sk|pk|rk|ghp|gho|ghs|xox[abprs]|AIza|AKIA)[-_A-Za-z0-9]{8,}/g,
  /[A-Za-z0-9_\-+/=]{24,}/g,
  // A shorter run that mixes in a digit, such as a 20-character hex key.
  /\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{16,}\b/g,
];

const REDACTED = "[removed]";

export function withoutSecretShapes(text: string): string {
  return SECRET_SHAPES.reduce((clean, shape) => clean.replace(shape, REDACTED), text);
}

/** A name or label is short and plain: letters, digits, spaces and a few marks, never more than this. */
export const MAX_FREE_TEXT_CHARS = 40;
const OUTSIDE_PLAIN_TEXT = /[^\p{L}\p{N} .,\-_()+&'#[\]]/gu;

/**
 * Free text a person typed (a provider's display name, a plan label) before it joins the facts:
 * secret-shaped parts replaced, everything outside a small set of characters dropped, then cut to
 * a short length. The character set and the cap hold even where no pattern matches.
 */
export function plainFreeText(text: string): string {
  return withoutSecretShapes(text)
    .replace(OUTSIDE_PLAIN_TEXT, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FREE_TEXT_CHARS)
    .trim();
}

/* oxlint-disable t3code/no-untranslated-copy -- status words in the notes sent to the model, not shown to the person */
const STATE_WORDS = {
  ready: "Ready",
  warning: "Needs attention",
  error: "Failed",
  disabled: "Off",
  neutral: "Checking",
} as const;
/* oxlint-enable t3code/no-untranslated-copy */

function planOf(provider: ServerProvider, resolve: MessageResolver): string | null {
  if (provider.auth.status !== "authenticated") return null;
  const label = providerAuthLabel(provider.auth, resolve);
  return label === undefined ? null : plainFreeText(providerPlanLabel(label));
}

/** Names and states from the server's provider list and the environment's settings. */
export function buildSetupSnapshot(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: {
    readonly usageLimitSources: Record<
      string,
      { readonly kind: string; readonly enabled: boolean }
    >;
    // The service and whether it is on: the generator's key and address are never read.
    readonly textGenerators: Record<string, { readonly kind: string; readonly enabled: boolean }>;
  };
  readonly resolve: MessageResolver;
  /** The person was reading another machine's Settings than the one the conversation runs on. */
  readonly otherMachineViewed?: boolean;
}): SetupSnapshot {
  return {
    ...(input.otherMachineViewed ? { otherMachineViewed: true } : {}),
    providers: input.providers.map((provider) => ({
      name: plainFreeText(provider.displayName ?? provider.driver),
      driver: plainFreeText(provider.driver),
      enabled: provider.enabled,
      state: STATE_WORDS[getProviderStatusKey(provider)],
      plan: planOf(provider, input.resolve),
    })),
    usageSources: Object.values(input.settings.usageLimitSources).map((source) => ({
      kind: source.kind === "http" ? "http" : "hub",
      enabled: source.enabled,
    })),
    textGenerators: Object.values(input.settings.textGenerators).map((generator) => ({
      service: plainFreeText(generator.kind),
      enabled: generator.enabled,
    })),
  };
}
