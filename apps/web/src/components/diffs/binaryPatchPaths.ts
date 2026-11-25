const PATCH_MARKERS = /^diff --git a\/.* b\/(.*)$|^(Binary files .* differ|GIT binary patch)$/gm;

/**
 * Paths the patch itself marks binary: a `diff --git` header followed by Git's
 * "Binary files … differ" line or a "GIT binary patch" block before the next header.
 * Eager diffs carry no numstat, so this reads the one place Git recorded the answer.
 */
export function binaryPatchPaths(patch: string): ReadonlyArray<string> {
  const paths: string[] = [];
  let current: string | null = null;
  for (const match of patch.matchAll(PATCH_MARKERS)) {
    if (match[1] !== undefined) {
      current = match[1];
    } else if (current !== null) {
      paths.push(current);
      current = null;
    }
  }
  return paths;
}
