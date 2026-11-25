/** The provider count last shown for a selection, so the next skeleton has the right row count. */
const providerCounts = new Map<string, number>();

/** One key per selection of environments: all of them, or the sorted ids chosen. */
export function selectionKey(selected: ReadonlySet<string> | null): string {
  return selected === null ? "all" : [...selected].toSorted().join(",");
}

export function rememberProviderCount(key: string, count: number): void {
  if (count > 0) providerCounts.set(key, count);
}

export function recalledProviderCount(key: string, fallback: number): number {
  return providerCounts.get(key) ?? fallback;
}
