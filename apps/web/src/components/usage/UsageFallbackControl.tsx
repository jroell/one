import { useAtomValue } from "@effect/atom-react";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { exhaustedUsageWindow, fallbackOfferFor } from "@t3tools/shared/usageLimits";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { useGT, useMessages } from "gt-react";
import { useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { providerClients } from "../settings/providerDriverMeta";
import { Button } from "../ui/button";

/** The standing fallback model, read from this machine's settings and written back to them. */
export interface UsageFallbackTarget {
  readonly environmentId: EnvironmentId;
  readonly exhausted: ServerProvider;
  readonly providers: readonly ServerProvider[];
}

const providerName = (provider: ServerProvider) =>
  providerClients.get(provider.driver)?.label ?? provider.displayName?.trim() ?? provider.driver;

/**
 * Beside a provider that is out of usage: switch new threads to another ready provider until it
 * resets (the setting new-thread model resolution already reads), say what it did, and undo it.
 */
export function UsageFallbackControl({
  target,
  now,
  compact = false,
}: {
  readonly target: UsageFallbackTarget;
  readonly now: number;
  /** In a popover: no page padding. */
  readonly compact?: boolean;
}) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const { environmentId, exhausted, providers } = target;
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  // What this control itself set, so the line it shows stays an undoable message, not a status.
  const [done, setDone] = useState<ModelSelection | null>(null);
  const [failed, setFailed] = useState<"set" | "undo" | null>(null);
  const [pending, setPending] = useState(false);

  const offer = fallbackOfferFor({
    exhausted,
    providers,
    fallbackSelection: settings?.fallbackModelSelection ?? null,
    now,
  });
  const window = exhaustedUsageWindow(exhausted, now);
  const from = providerName(exhausted);
  const nameOf = (selection: ModelSelection) => {
    const provider = providers.find((entry) => entry.instanceId === selection.instanceId);
    return provider ? providerName(provider) : selection.model;
  };
  const resets =
    window?.resetsAt !== undefined
      ? formatUpcomingTimestamp(window.resetsAt, timestampFormat, now, undefined, m)
      : null;

  const write = async (selection: ModelSelection | null) => {
    setPending(true);
    setFailed(null);
    const result = await update({
      environmentId,
      input: { patch: { fallbackModelSelection: selection } },
    });
    setPending(false);
    if (result._tag === "Success") {
      setDone(selection);
      return;
    }
    if (!isAtomCommandInterrupted(result)) setFailed(selection === null ? "undo" : "set");
  };

  if (done !== null) {
    return (
      <div className={compact ? "usage-fallback usage-fallback-compact" : "usage-fallback"}>
        <p className="usage-fallback-text" role="status">
          {resets
            ? gt("New threads use {to} until {from} resets on {resets}.", {
                to: nameOf(done),
                from,
                resets,
              })
            : gt("New threads use {to} until {from} resets.", { to: nameOf(done), from })}
        </p>
        <Button variant="ghost-muted" size="xs" disabled={pending} onClick={() => void write(null)}>
          {gt("Undo")}
        </Button>
      </div>
    );
  }
  if (offer.kind === "already") {
    return (
      <div className={compact ? "usage-fallback usage-fallback-compact" : "usage-fallback"}>
        <p className="usage-fallback-text">
          {gt("New threads use {to} while {from} is out of usage.", {
            to: nameOf(offer.selection),
            from,
          })}
        </p>
      </div>
    );
  }
  if (offer.kind === "none") {
    return (
      <div className={compact ? "usage-fallback usage-fallback-compact" : "usage-fallback"}>
        <p className="usage-fallback-text">
          {offer.reason === "none-signed-in"
            ? gt("No other provider is signed in on this machine.")
            : gt("No other signed-in provider has usage left.")}
        </p>
      </div>
    );
  }
  if (!canWrite) return null;
  return (
    <div className={compact ? "usage-fallback usage-fallback-compact" : "usage-fallback"}>
      {failed ? (
        <p className="usage-fallback-text" role="alert">
          {failed === "set"
            ? gt("Could not change the fallback model.")
            : gt("Could not undo the fallback model.")}
        </p>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void write(offer.selection)}
      >
        {failed
          ? gt("Retry")
          : gt("Use {to} until {from} resets", { to: providerName(offer.provider), from })}
      </Button>
    </div>
  );
}
