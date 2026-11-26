import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProviderInstanceConfig } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { useState } from "react";

import {
  useEnvironmentSettings,
  usePersistEnvironmentProviderInstanceMutation,
} from "../../../hooks/useSettings";
import { providersIgnoringCheckedAtAtom } from "../../../state/server";
import { Button } from "../../ui/button";
import { chooseProviderFix } from "./explainProviderFix.logic";

/**
 * What to do when no AI provider is ready: switch on one the person already installed and signed
 * in to, in place, or else open the page that adds one.
 */
export function ExplainProviderFix({
  environmentId,
  onOpenProviders,
}: {
  readonly environmentId: EnvironmentId;
  readonly onOpenProviders: () => void;
}) {
  const gt = useGT();
  const providers = useAtomValue(providersIgnoringCheckedAtAtom(environmentId));
  const settings = useEnvironmentSettings(environmentId);
  const persist = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const fix = chooseProviderFix(providers);
  const router = useRouter({ warn: false });
  if (fix.kind === "none") return null;
  const candidate = fix.kind === "turn-on" ? fix.provider : undefined;

  const turnOn = async () => {
    if (candidate === undefined) return;
    setBusy(true);
    setFailure(null);
    const config: ProviderInstanceConfig = settings.providerInstances?.[candidate.instanceId] ?? {
      driver: candidate.driver,
    };
    const result = await persist({
      operation: "upsert",
      instanceId: candidate.instanceId,
      instance: { ...config, enabled: true },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setFailure(error instanceof Error ? error.message : gt("The settings update failed."));
    }
  };

  return (
    <div className="grid gap-1.5">
      {candidate === undefined ? (
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            onOpenProviders();
            void router?.navigate({ to: "/settings/providers" });
          }}
        >
          {gt("Open providers")}
        </Button>
      ) : (
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void turnOn()}>
          {gt("Turn on {provider}", {
            provider: candidate.displayName?.trim() || String(candidate.driver),
          })}
        </Button>
      )}
      {failure === null ? null : (
        <p role="alert" className="text-xs text-pretty text-destructive-foreground">
          {failure}
        </p>
      )}
    </div>
  );
}
