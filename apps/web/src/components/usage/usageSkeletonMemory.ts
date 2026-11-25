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

const snapshots = new Map<string, unknown>();

/** The key of one view of the page: its selection and filter, and the period shown. */
export function snapshotKey(selection: string, windowDays: number): string {
  return `${selection}@${windowDays}`;
}

/** The last settled figures for a view, kept for this session so reopening shows them at once. */
export function rememberSnapshot<Snapshot>(key: string, snapshot: Snapshot): void {
  snapshots.set(key, snapshot);
}

export function recalledSnapshot<Snapshot>(key: string): Snapshot | null {
  return (snapshots.get(key) as Snapshot | undefined) ?? null;
}
