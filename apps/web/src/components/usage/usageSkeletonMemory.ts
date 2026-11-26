/** The provider count last shown for a selection, so the next skeleton has the right row count. */
const providerCounts = new Map<string, number>();

/**
 * One key per selection: the environments chosen (all, or the sorted ids) and the providers
 * hidden, since both change how many provider rows the page shows.
 */
export function selectionKey(
  selected: ReadonlySet<string> | null,
  hiddenProviders: ReadonlySet<string>,
): string {
  const environments = selected === null ? "all" : [...selected].toSorted().join(",");
  return `${environments}|hidden:${[...hiddenProviders].toSorted().join(",")}`;
}

/** A settled answer of zero is remembered like any other count. */
export function rememberProviderCount(key: string, count: number): void {
  providerCounts.set(key, count);
}

export function recalledProviderCount(key: string, fallback: number): number {
  return providerCounts.get(key) ?? fallback;
}

/**
 * An environment contributing to the figures, with the authorization generation that produced them
 * (see `EnvironmentAuthorization`) and the model filter it is queried by.
 */
export interface UsageContributor {
  readonly id: string;
  readonly generation: string;
  readonly modelFilter: string;
}

/**
 * The key of one view: the environments that contribute, each at the authorization generation it
 * answered under (only those whose grant is confirmed and allows usage), the model filter each is
 * asked with, the hidden providers, and the period with its time zone and resolution.
 */
export function usageViewKey(view: {
  readonly contributors: readonly UsageContributor[];
  readonly hiddenProviders: ReadonlySet<string>;
  readonly windowDays: number;
  readonly timeZone: string;
  readonly resolution: string | undefined;
}): string {
  const contributors = view.contributors
    .map((entry) => `${entry.id}@${entry.generation}:${entry.modelFilter}`)
    .toSorted()
    .join(",");
  const hidden = [...view.hiddenProviders].toSorted().join(",");
  return `${contributors}|hidden:${hidden}|${view.windowDays}d|${view.timeZone}|${view.resolution ?? ""}`;
}

/** Enough for the views a person flips between; older ones go first. */
const MAX_SNAPSHOTS = 6;

/*
 * Invariant: kept figures replay only for the exact view that produced them, while every contributor
 * is still at the authorization generation it answered under with a confirmed grant. Events that stop
 * a replay: revoke, replaced credentials, removal, re-pairing, sign-out, another filter, zone or period.
 */
const snapshots = new Map<
  string,
  {
    readonly contributors: readonly { readonly id: string; readonly generation: string }[];
    readonly value: unknown;
  }
>();

/** The last settled figures for a view, kept for this session so reopening shows them at once. */
export function rememberSnapshot<Snapshot>(
  key: string,
  contributors: readonly UsageContributor[],
  snapshot: Snapshot,
): void {
  snapshots.delete(key);
  snapshots.set(key, {
    contributors: contributors.map(({ id, generation }) => ({ id, generation })),
    value: snapshot,
  });
  for (const oldest of snapshots.keys()) {
    if (snapshots.size <= MAX_SNAPSHOTS) break;
    snapshots.delete(oldest);
  }
}

export function recalledSnapshot<Snapshot>(key: string): Snapshot | null {
  return (snapshots.get(key)?.value as Snapshot | undefined) ?? null;
}

/**
 * Keeps only the views whose contributors are all still current: present, authorized and confirmed
 * at the generation they answered under. `current` maps those environments to their generation, so
 * an environment that was removed (absent from it) or replaced (another generation) evicts its views.
 */
export function pruneSnapshots(current: ReadonlyMap<string, string>): void {
  for (const [key, entry] of snapshots) {
    if (entry.contributors.some(({ id, generation }) => current.get(id) !== generation)) {
      snapshots.delete(key);
    }
  }
}
