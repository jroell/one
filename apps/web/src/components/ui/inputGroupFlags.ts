const counts = new WeakMap<HTMLElement, Map<string, number>>();

/**
 * Sets `data-has-<flag>` on the input group around `node` while `node` is mounted. Styles read
 * the attribute; a `:has()` on the group in front of a descendant selector restyled the whole page.
 */
export function flagInputGroup(node: HTMLElement | null, flag: string): (() => void) | undefined {
  const group = node?.closest<HTMLElement>("[data-slot=input-group]");
  if (!group) return undefined;
  const flags = counts.get(group) ?? new Map<string, number>();
  counts.set(group, flags);
  flags.set(flag, (flags.get(flag) ?? 0) + 1);
  group.setAttribute(`data-has-${flag}`, "");
  return () => {
    const left = (flags.get(flag) ?? 1) - 1;
    flags.set(flag, left);
    if (left <= 0) group.removeAttribute(`data-has-${flag}`);
  };
}
