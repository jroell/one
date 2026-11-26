const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

interface ReviewFile {
  readonly path: string;
  readonly binary?: boolean | undefined;
}

/**
 * Files list one folder at a time, and a folder's whole subtree stays together: `a/root.ts`,
 * `a/sub/part.ts`, then `a-b/ext.ts`, whatever characters sort between the names. Inside a folder
 * the text files come first, then the binaries, then the subfolders. A file tree built from
 * the order of the list (by where each file and folder first appears) lists them the same way.
 */
export function compareReviewFiles(a: ReviewFile, b: ReviewFile): number {
  const left = a.path.split("/");
  const right = b.path.split("/");
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const leftIsFile = index === left.length - 1;
    const rightIsFile = index === right.length - 1;
    if (leftIsFile !== rightIsFile) return leftIsFile ? -1 : 1;
    if (leftIsFile) {
      if ((a.binary === true) !== (b.binary === true)) return a.binary === true ? 1 : -1;
      return collator.compare(left[index]!, right[index]!);
    }
    const byName = collator.compare(left[index]!, right[index]!);
    if (byName !== 0) return byName;
    // Names that collate equal (`folder01`, `folder1`) are still two folders: break the tie on the
    // exact name before going inside, or their files interleave.
    if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
  }
  return 0;
}
