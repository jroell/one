import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";

const FILE_HEADER = /^diff --git /m;
const BINARY_MARKER = /^(?:Binary files .* differ|GIT binary patch)$/m;

/**
 * The files the patch itself marks binary, named the way the diff renderer names them.
 * Each `diff --git` block is checked for Git's "Binary files … differ" line or a "GIT binary
 * patch" body, and a marked block is parsed by the renderer's own parser, so quoted names,
 * renames and names containing " b/" resolve by the same rules the headers above them do.
 */
export function binaryPatchPaths(patch: string): ReadonlyArray<string> {
  const paths: string[] = [];
  const blocks = patch.split(/^(?=diff --git )/m).filter((block) => FILE_HEADER.test(block));
  for (const block of blocks) {
    if (!BINARY_MARKER.test(block)) continue;
    for (const parsed of parsePatchFiles(block)) {
      for (const file of parsed.files) paths.push(file.name);
    }
  }
  return paths;
}
