import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { useState } from "react";

import { useNowMinute } from "../../../hooks/useNowMinute";
import { useEnvironmentSettings } from "../../../hooks/useSettings";
import { providersIgnoringCheckedAtAtom } from "../../../state/server";
import { Button } from "../../ui/button";
import { useProviderInstancePersister } from "../useProviderInstancePersister";
import { chooseProviderFix, withProviderInstanceEnabled } from "./explainProviderFix.logic";

/**
 * What to do when no AI provider is ready: switch on an instance the person turned off, in place
 * and through the same save the Providers page uses, or else open the page that adds one.
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
  const persist = useProviderInstancePersister(environmentId, settings);
  const [busy, setBusy] = useState(false);
  const now = Date.parse(`${useNowMinute()}:00.000Z`);
  const fix = chooseProviderFix({ instances: settings.providerInstances, providers, now });
  const router = useRouter({ warn: false });
  if (fix.kind === "none") return null;

  const turnOn = async () => {
    if (fix.kind !== "turn-on") return;
    setBusy(true);
    await persist(fix.instanceId, withProviderInstanceEnabled(fix.instance));
    setBusy(false);
  };

  return (
    <div className="grid gap-1.5">
      {fix.kind === "open-providers" ? (
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
          {gt("Turn on {provider}", { provider: fix.name })}
        </Button>
      )}
    </div>
  );
}
