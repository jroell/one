import { useAtomValue } from "@effect/atom-react";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import { exhaustedUsageWindow, fallbackOfferFor } from "@t3tools/shared/usageLimits";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { useGT, useMessages } from "gt-react";
import { useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";

/** The standing fallback model, read from this machine's settings and written back to them. */
export interface UsageFallbackTarget {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel?: string | undefined;
  readonly exhausted: ServerProvider;
  readonly providers: readonly ServerProvider[];
}

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
  const { environmentId, environmentLabel, exhausted, providers } = target;
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const [change, setChange] = useState<{
    readonly previous: ModelSelection | null;
    readonly selection: ModelSelection;
  } | null>(null);
  const [failed, setFailed] = useState<"set" | "undo" | null>(null);
  const [pending, setPending] = useState(false);

  const fallbackSelection = settings?.fallbackModelSelection ?? null;
  const offer = fallbackOfferFor({
    exhausted,
    providers,
    fallbackSelection,
    now,
    ...(settings === null ? {} : { settings }),
  });
  const undoable =
    change !== null &&
    offer.kind === "already" &&
    modelSelectionsEqual(offer.selection, change.selection)
      ? change
      : null;
  const window = exhaustedUsageWindow(exhausted, now);
  const from = resolveProviderInstanceDisplayName(exhausted);
  const nameOf = (selection: ModelSelection) => {
    const provider = providers.find((entry) => entry.instanceId === selection.instanceId);
    return provider ? resolveProviderInstanceDisplayName(provider) : selection.model;
  };
  const resets =
    window?.resetsAt !== undefined
      ? formatUpcomingTimestamp(window.resetsAt, timestampFormat, now, undefined, m)
      : null;

  const write = async (selection: ModelSelection | null, action: "set" | "undo") => {
    setPending(true);
    setFailed(null);
    const result = await update({
      environmentId,
      input: { patch: { fallbackModelSelection: selection } },
    });
    setPending(false);
    if (result._tag === "Success") {
      setChange(
        action === "set" && selection !== null ? { previous: fallbackSelection, selection } : null,
      );
      return;
    }
    if (!isAtomCommandInterrupted(result)) setFailed(action);
  };

  let content;
  if (undoable !== null) {
    content = (
      <>
        <p className="usage-fallback-text" role="status">
          {resets
            ? gt("New threads use {to} until {from} resets on {resets}.", {
                to: nameOf(undoable.selection),
                from,
                resets,
              })
            : gt("New threads use {to} until {from} resets.", {
                to: nameOf(undoable.selection),
                from,
              })}
        </p>
        <Button
          variant="ghost-muted"
          size="xs"
          disabled={pending || !canWrite}
          onClick={() => void write(undoable.previous, "undo")}
        >
          {gt("Undo")}
        </Button>
      </>
    );
  } else if (offer.kind === "already") {
    content = (
      <p className="usage-fallback-text">
        {gt("New threads use {to} while {from} is out of usage.", {
          to: nameOf(offer.selection),
          from,
        })}
      </p>
    );
  } else if (offer.kind === "none") {
    content = (
      <p className="usage-fallback-text">
        {offer.reason === "none-signed-in"
          ? gt("No other provider is signed in on this machine.")
          : offer.reason === "none-ready"
            ? gt("No other signed-in provider is ready.")
            : gt("No other signed-in provider has usage left.")}
      </p>
    );
  } else {
    if (!canWrite || settings === null) return null;
    content = (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void write(offer.selection, "set")}
      >
        {failed === "set"
          ? gt("Retry")
          : gt("Use {to} until {from} resets", {
              to: resolveProviderInstanceDisplayName(offer.provider),
              from,
            })}
      </Button>
    );
  }

  return (
    <div
      className={compact ? "usage-fallback usage-fallback-compact" : "usage-fallback"}
      role={environmentLabel === undefined ? undefined : "group"}
      aria-label={environmentLabel}
    >
      {environmentLabel !== undefined ? (
        <p className="usage-fallback-text w-full font-medium">{environmentLabel}</p>
      ) : null}
      {failed ? (
        <p className="usage-fallback-text" role="alert">
          {failed === "set"
            ? gt("Could not change the fallback model.")
            : gt("Could not undo the fallback model.")}
        </p>
      ) : null}
      {content}
    </div>
  );
}
