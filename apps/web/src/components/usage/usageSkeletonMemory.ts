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

/** An environment that can contribute to the figures, with the model filter it is queried by. */
export interface UsageContributor {
  readonly id: string;
  readonly modelFilter: string;
}

/**
 * The key of one view: the environments that actually contribute (those authorized to read usage,
 * so a machine that lost access changes it), the model filter each is asked with, the hidden
 * providers, and the period with its time zone and resolution. Figures are only ever replayed for
 * the exact view that produced them.
 */
export function usageViewKey(view: {
  readonly contributors: readonly UsageContributor[];
  readonly hiddenProviders: ReadonlySet<string>;
  readonly windowDays: number;
  readonly timeZone: string;
  readonly resolution: string | undefined;
}): string {
  const contributors = view.contributors
    .map((entry) => `${entry.id}:${entry.modelFilter}`)
    .toSorted()
    .join(",");
  const hidden = [...view.hiddenProviders].toSorted().join(",");
  return `${contributors}|hidden:${hidden}|${view.windowDays}d|${view.timeZone}|${view.resolution ?? ""}`;
}

/** Enough for the views a person flips between; older ones go first. */
const MAX_SNAPSHOTS = 6;

const snapshots = new Map<
  string,
  { readonly contributors: readonly string[]; readonly value: unknown }
>();

/** The last settled figures for a view, kept for this session so reopening shows them at once. */
export function rememberSnapshot<Snapshot>(
  key: string,
  contributors: readonly string[],
  snapshot: Snapshot,
): void {
  snapshots.delete(key);
  snapshots.set(key, { contributors, value: snapshot });
  for (const oldest of snapshots.keys()) {
    if (snapshots.size <= MAX_SNAPSHOTS) break;
    snapshots.delete(oldest);
  }
}

export function recalledSnapshot<Snapshot>(key: string): Snapshot | null {
  return (snapshots.get(key)?.value as Snapshot | undefined) ?? null;
}

/** Drops every kept view that included this environment, for when it is gone or loses access. */
export function forgetEnvironmentSnapshots(environmentId: string): void {
  for (const [key, entry] of snapshots) {
    if (entry.contributors.includes(environmentId)) snapshots.delete(key);
  }
}
