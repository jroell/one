/** The provider count last shown for a selection, so the next skeleton has the right row count. */
const providerCounts = new Map<string, number>();

/**
 * One key per selection: the machines present, the environments chosen (all, or the sorted ids) and
 * the providers hidden, since each changes how many provider rows the page shows. The machines
 * present are in it so another account's list in the same browser profile never recalls this one's.
 */
export function selectionKey(
  selected: ReadonlySet<string> | null,
  hiddenProviders: ReadonlySet<string>,
  presentEnvironmentIds: Iterable<string>,
): string {
  const environments = selected === null ? "all" : [...selected].toSorted().join(",");
  const present = [...presentEnvironmentIds].toSorted().join(",");
  return `${present}|${environments}|hidden:${[...hiddenProviders].toSorted().join(",")}`;
}

const COUNT_STORAGE_KEY = "one:usage:providers";
const LEGACY_COUNT_PREFIX = "one:usage:providers:";
/** A person flips between a few selections; the oldest go first. */
const MAX_STORED_COUNTS = 8;

function readStoredCounts(): [string, number][] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COUNT_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is [string, number] =>
        Array.isArray(entry) && typeof entry[0] === "string" && Number.isInteger(entry[1]),
    );
  } catch {
    return [];
  }
}

function removeLegacyCounts(): void {
  for (const name of Object.keys(localStorage)) {
    if (name.startsWith(LEGACY_COUNT_PREFIX)) localStorage.removeItem(name);
  }
}

/** A settled answer of zero is remembered like any other count, and kept for the next session. */
export function rememberProviderCount(key: string, count: number): void {
  if (providerCounts.get(key) === count) return;
  providerCounts.set(key, count);
  try {
    const kept = readStoredCounts().filter(([stored]) => stored !== key);
    kept.push([key, count]);
    localStorage.setItem(COUNT_STORAGE_KEY, JSON.stringify(kept.slice(-MAX_STORED_COUNTS)));
    removeLegacyCounts();
  } catch {
    // Private windows and blocked storage keep the count for this session only.
  }
}

export function recalledProviderCount(key: string, fallback: number): number {
  const kept = providerCounts.get(key);
  if (kept !== undefined) return kept;
  return readStoredCounts().find(([stored]) => stored === key)?.[1] ?? fallback;
}

/** An environment was removed or the account changed: no count kept for the old machines applies. */
export function forgetProviderCounts(): void {
  providerCounts.clear();
  try {
    localStorage.removeItem(COUNT_STORAGE_KEY);
    removeLegacyCounts();
  } catch {
    // Nothing kept in blocked storage.
  }
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
