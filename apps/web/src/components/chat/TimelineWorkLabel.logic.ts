export interface WorkLabelParts {
  readonly before: string;
  readonly object: string;
  readonly after: string;
}

/**
 * Finds the object a work row acts on (a path or a command) inside its already-translated
 * label, so the verb stays prose and the object can take the mono face.
 */
export function splitWorkLabel(
  label: string,
  objects: ReadonlyArray<string | null | undefined>,
): WorkLabelParts | null {
  let best: { index: number; object: string } | null = null;
  for (const candidate of objects) {
    const object = candidate?.trim();
    if (!object || object.includes("\n")) continue;
    const index = label.indexOf(object);
    if (index === -1) continue;
    if (best === null || object.length > best.object.length) best = { index, object };
  }
  if (best === null) {
    const ticked = /`([^`\n]+)`/.exec(label);
    if (ticked?.index === undefined) return null;
    return {
      before: label.slice(0, ticked.index),
      object: ticked[1] ?? "",
      after: label.slice(ticked.index + ticked[0].length),
    };
  }
  return {
    before: label.slice(0, best.index),
    object: best.object,
    after: label.slice(best.index + best.object.length),
  };
}

/** A path splits into a directory that may truncate and a name that always stays visible. */
export function splitObjectPath(object: string): { dir: string; base: string } {
  const slash = object.lastIndexOf("/");
  if (slash <= 0 || slash === object.length - 1) return { dir: "", base: object };
  return { dir: object.slice(0, slash + 1), base: object.slice(slash + 1) };
}

/** A path under a user's home folder reads as `~/…`, the way settings show it. Display only. */
export function abbreviateHomePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/\s]+(?=\/)/, "~");
}
