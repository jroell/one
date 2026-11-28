import { forgetProviderCounts } from "../components/usage/usageSkeletonMemory";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthProvidersManageScope,
  AuthDiagnosticsReadScope,
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type UsageBucket,
  type UsageAccessRequest,
  type UsageSummary,
  type UsageProviderKind,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import { refreshUsage, usageSummaryInput } from "@t3tools/client-runtime/state/usage";
import {
  resolveUsageAccess,
  unansweredUsageAccessRequests,
} from "@t3tools/client-runtime/state/usage-access";
import { AsyncResult, Atom } from "effect/reactivity";
import { msg } from "gt-react";
import { useState } from "react";

import { mergeUsage, type EnvironmentUsage, type MergedUsage } from "@t3tools/shared/usageMerge";
import { appAtomRegistry, subscribeAtomChanges } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";
import {
  environmentAuthorization,
  environmentSession,
  forgetEnvironmentAuthorization,
  readEnvironmentScope,
  sessionHasScope,
} from "./session";
import { m } from "../i18n/messages";

export interface EnvironmentUsageStatus {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPending: boolean;
  readonly canReadDiagnostics: boolean;
  /** Agents still waiting for a usage access answer that this session may save. */
  readonly accessRequests: readonly UsageAccessRequest[];
  readonly isConnected: boolean;
  readonly error: string | null;
  readonly summary: UsageSummary | null;
  /** The authorization these figures belong to: changes on replaced credentials, removal, re-pairing. */
  readonly generation: string;
}

// Removal ends an environment's authorization even when the same credential returns later and
// whether or not Usage is open, so this watches the list for the life of the app.
let presentEnvironments = new Set(
  appAtomRegistry.get(environmentPresentations.presentationsAtom).keys(),
);
subscribeAtomChanges(environmentPresentations.presentationsAtom, (presentations) => {
  for (const environmentId of presentEnvironments) {
    if (!presentations.has(environmentId)) {
      forgetEnvironmentAuthorization(environmentId);
      forgetProviderCounts();
    }
  }
  presentEnvironments = new Set(presentations.keys());
});

/*
 * Which authorization produced the figures a query shows. A query atom keeps its last value while it
 * reads again, even after the machine's credentials were replaced or it was paired again, so a
 * waiting value only counts when this module saw it settle under the current generation.
 */
const settledUnder = new Map<string, { readonly generation: string; readonly result: unknown }>();

/**
 * More than the queries one screen holds at once (environments times the views flipped between);
 * the past-24-hours view adds a key every minute it is refreshed, and the least recently read go.
 */
const MAX_SETTLED = 64;

export function settledSummaryCount(): number {
  return settledUnder.size;
}

export function summaryUnder(
  queryKey: string,
  generation: string,
  result: AsyncResult.AsyncResult<UsageSummary, unknown>,
): UsageSummary | null {
  let entry = settledUnder.get(queryKey);
  if (AsyncResult.isSuccess(result) && !result.waiting && entry?.result !== result) {
    entry = { generation, result };
  }
  if (entry !== undefined) {
    settledUnder.delete(queryKey);
    settledUnder.set(queryKey, entry);
    for (const oldest of settledUnder.keys()) {
      if (settledUnder.size <= MAX_SETTLED) break;
      settledUnder.delete(oldest);
    }
  }
  return entry?.generation === generation ? AsyncResult.getOrElse(result, () => null) : null;
}

const usageByWindowAtom = Atom.family((windowKey: string) =>
  Atom.make((get): readonly EnvironmentUsageStatus[] => {
    const input = JSON.parse(windowKey) as UsageSummaryInput;
    const presentations = get(environmentPresentations.presentationsAtom);

    const statuses: EnvironmentUsageStatus[] = [];
    for (const [environmentId, presentation] of presentations) {
      const isConnected = presentation.connection.phase === "connected";
      const authorization = get(environmentAuthorization(environmentId));
      const sessionResult = get(environmentSession.sessionStateAtom(environmentId));
      const hasSessionError = sessionResult._tag === "Failure";
      // The session atom keeps the previous grant while a replacement check is in flight. Until the
      // check has answered for this authorization, the grant is treated as not yet known.
      const access = resolveUsageAccess(
        {
          connectionPhase: presentation.connection.phase,
          session:
            authorization.confirmed || hasSessionError
              ? AsyncResult.getOrElse(sessionResult, () => null)
              : null,
          hasSessionError,
        },
        m,
      );
      if (!access.canReadDiagnostics) {
        statuses.push({
          environmentId,
          label: presentation.entry.target.label,
          isConnected,
          ...access,
          accessRequests: [],
          summary: null,
          generation: authorization.generation,
        });
        continue;
      }
      const query = usageSummaryInput(
        input,
        get(serverEnvironment.usageModelFilterAtom(environmentId)),
      );
      const result = get(serverEnvironment.usageSummary({ environmentId, input: query }));
      const summary = summaryUnder(
        `${environmentId}|${JSON.stringify(query)}`,
        authorization.generation,
        result,
      );
      statuses.push({
        environmentId,
        label: presentation.entry.target.label,
        isPending: result.waiting || (summary === null && AsyncResult.isSuccess(result)),
        canReadDiagnostics: true,
        accessRequests: unansweredUsageAccessRequests({
          canAnswer: sessionHasScope(sessionResult, AuthProvidersManageScope),
          summary,
          config: get(serverEnvironment.configValueAtom(environmentId)),
        }),
        isConnected,
        error:
          result._tag === "Failure" ? m(msg("This environment could not report usage.")) : null,
        summary,
        generation: authorization.generation,
      });
    }
    return statuses;
  }).pipe(Atom.withLabel(`web-usage:window:${windowKey}`)),
);

export interface UsageView {
  readonly merged: MergedUsage;
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  readonly isPending: boolean;
  readonly shown: { readonly window: UsageSummaryInput; readonly merged: MergedUsage } | null;
  readonly isPartial: boolean;
  readonly refresh: (input?: UsageSummaryInput) => Promise<void>;
}

export function mergeAnsweredUsage(
  environments: readonly EnvironmentUsageStatus[],
  keepBucket?: (bucket: UsageBucket) => boolean,
): MergedUsage {
  const answered: EnvironmentUsage[] = environments.flatMap(({ environmentId, label, summary }) =>
    summary === null
      ? []
      : [
          {
            environmentId,
            label,
            summary:
              keepBucket === undefined
                ? summary
                : { ...summary, buckets: summary.buckets.filter(keepBucket) },
          },
        ],
  );
  return mergeUsage(answered, USAGE_CONTRACT_VERSION);
}

const NO_HIDDEN_PROVIDERS: ReadonlySet<UsageProviderKind> = new Set();

function withoutProviders(
  environments: readonly EnvironmentUsageStatus[],
  hiddenProviders: ReadonlySet<UsageProviderKind>,
): readonly EnvironmentUsageStatus[] {
  if (hiddenProviders.size === 0) return environments;
  return environments.map((environment) =>
    environment.summary === null
      ? environment
      : {
          ...environment,
          summary: {
            ...environment.summary,
            buckets: environment.summary.buckets.filter(
              (bucket) => !hiddenProviders.has(bucket.provider),
            ),
            sources: environment.summary.sources.filter(
              (source) => !hiddenProviders.has(source.fingerprint.provider),
            ),
          },
        },
  );
}

function deriveSelection(
  environments: readonly EnvironmentUsageStatus[],
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null,
  hiddenProviders: ReadonlySet<UsageProviderKind>,
) {
  const selectedEnvironments =
    selectedEnvironmentIds === null
      ? environments
      : environments.filter((environment) => selectedEnvironmentIds.has(environment.environmentId));
  return {
    environments,
    selectedEnvironmentIds,
    hiddenProviders,
    selectedEnvironments,
    merged: mergeAnsweredUsage(withoutProviders(selectedEnvironments, hiddenProviders)),
  };
}

function usageWindowKey(input: UsageSummaryInput): string {
  return JSON.stringify({
    sinceDay: input.sinceDay,
    untilDay: input.untilDay,
    timeZone: input.timeZone,
    resolution: input.resolution,
    sinceTime: input.sinceTime,
    untilTime: input.untilTime,
  });
}

/** Long enough to cover the move from the sidebar button to the opened page, and a slow open. */
const PREFETCH_HOLD_MS = 30_000;
let prefetched: { readonly key: string; readonly release: () => void } | null = null;
let prefetchTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Starts the query a Usage page would start for this window, so its answer is waiting when the page
 * opens. It reads the same atom the page reads, so what the page shows is still decided there: a
 * machine whose credential is not confirmed asks nothing and answers nothing for any generation.
 * The atom is held for a short while and let go when the page does not come.
 */
export function prefetchUsage(input: UsageSummaryInput): void {
  const key = usageWindowKey(input);
  if (prefetched?.key !== key) {
    prefetched?.release();
    prefetched = { key, release: appAtomRegistry.mount(usageByWindowAtom(key)) };
  }
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    prefetched?.release();
    prefetched = null;
  }, PREFETCH_HOLD_MS);
}

export function useUsage(
  input: UsageSummaryInput,
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null = null,
  hiddenProviders: ReadonlySet<UsageProviderKind> = NO_HIDDEN_PROVIDERS,
): UsageView {
  const windowKey = usageWindowKey(input);
  const atom = usageByWindowAtom(windowKey);
  const environments = useAtomValue(atom);
  // Identity-based render sync needs a derivation retained by inputs across renders.
  const [derived, setDerived] = useState(() =>
    deriveSelection(environments, selectedEnvironmentIds, hiddenProviders),
  );
  let current = derived;
  if (
    derived.environments !== environments ||
    derived.selectedEnvironmentIds !== selectedEnvironmentIds ||
    derived.hiddenProviders !== hiddenProviders
  ) {
    current = deriveSelection(environments, selectedEnvironmentIds, hiddenProviders);
    setDerived(current);
  }
  const { selectedEnvironments, merged } = current;

  const refresh = (nextInput?: UsageSummaryInput) =>
    refreshUsage({
      registry: appAtomRegistry,
      server: serverEnvironment,
      presentations: environmentPresentations,
      environmentIds: selectedEnvironments
        .filter(
          (environment) =>
            environment.canReadDiagnostics &&
            readEnvironmentScope(environment.environmentId, AuthDiagnosticsReadScope),
        )
        .map(({ environmentId }) => environmentId),
      input: nextInput ?? (JSON.parse(windowKey) as UsageSummaryInput),
    });

  const answeredCount = selectedEnvironments.filter(
    (environment) => environment.summary !== null,
  ).length;
  const stillReporting = selectedEnvironments.filter(
    (environment) => environment.summary === null && environment.error === null,
  ).length;
  const isPending = answeredCount === 0 && stillReporting > 0;

  // The machines that actually contribute, with the model filter each is asked with. Figures carried
  // while a new answer is pending only belong to this exact set: a revoked grant, a removed machine
  // or another filter changes it, and the old aggregate is dropped.
  const contributors = selectedEnvironments
    .filter((environment) => environment.canReadDiagnostics)
    .map(
      (environment) =>
        `${environment.environmentId}@${environment.generation}:${JSON.stringify(
          appAtomRegistry.get(serverEnvironment.usageModelFilterAtom(environment.environmentId)) ??
            null,
        )}`,
    )
    .toSorted()
    .join(",");

  const [lastAnswered, setLastAnswered] = useState<
    | (NonNullable<UsageView["shown"]> & {
        readonly selection: typeof selectedEnvironmentIds;
        readonly hidden: typeof hiddenProviders;
        readonly contributors: string;
      })
    | null
  >(null);
  if (
    answeredCount > 0 &&
    (lastAnswered?.merged !== merged ||
      lastAnswered.window !== input ||
      lastAnswered.selection !== selectedEnvironmentIds ||
      lastAnswered.hidden !== hiddenProviders ||
      lastAnswered.contributors !== contributors)
  ) {
    setLastAnswered({
      window: input,
      merged,
      selection: selectedEnvironmentIds,
      hidden: hiddenProviders,
      contributors,
    });
  }
  const kept =
    lastAnswered?.selection === selectedEnvironmentIds &&
    lastAnswered.hidden === hiddenProviders &&
    lastAnswered.contributors === contributors
      ? lastAnswered
      : null;
  const shown =
    answeredCount > 0
      ? { window: input, merged }
      : (kept ?? (isPending ? null : { window: input, merged }));

  return {
    merged,
    environments,
    selectedEnvironments,
    isPending,
    shown,
    isPartial: answeredCount > 0 && stillReporting > 0,
    refresh,
  };
}
