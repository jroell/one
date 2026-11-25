const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * Files list by folder, and inside a folder the text files come before the binaries, so a
 * folder of images never pushes the code above them out of sight.
 */
export function compareReviewFiles(
  a: { readonly path: string; readonly binary?: boolean | undefined },
  b: { readonly path: string; readonly binary?: boolean | undefined },
): number {
  const byDirectory = collator.compare(directoryOf(a.path), directoryOf(b.path));
  if (byDirectory !== 0) return byDirectory;
  if ((a.binary === true) !== (b.binary === true)) return a.binary === true ? 1 : -1;
  return collator.compare(a.path, b.path);
}
