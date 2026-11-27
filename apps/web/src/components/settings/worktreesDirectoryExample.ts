/** A sample folder written the way the machine's own system writes paths. */
export function worktreesDirectoryExample(systems: ReadonlyArray<string | undefined>): string {
  const windows = systems.some((system) => system === "windows");
  const other = systems.length === 0 || systems.some((system) => system !== "windows");
  if (windows && other) return "D:\\worktrees or ~/worktrees";
  return windows ? "D:\\worktrees" : "~/worktrees";
}
