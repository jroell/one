import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { describe, expect, it } from "vite-plus/test";

import { binaryPatchPaths } from "./binaryPatchPaths";

const patch = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1..2 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "diff --git a/plain.txt b/plain.txt",
  "old mode 100644",
  "new mode 100755",
  'diff --git "a/r\\303\\251sum\\303\\251" "b/r\\303\\251sum\\303\\251"',
  "index 3..4 100644",
  'Binary files "a/r\\303\\251sum\\303\\251" and "b/r\\303\\251sum\\303\\251" differ',
  "diff --git a/contains b/dir b/contains b/dir",
  "index 5..6 100644",
  "Binary files a/contains b/dir and b/contains b/dir differ",
  "diff --git a/old-name.bin b/new-name.bin",
  "similarity index 90%",
  "rename from old-name.bin",
  "rename to new-name.bin",
  "index 7..8 100644",
  "GIT binary patch",
  "literal 12",
  "diff --git a/notes.db b/notes.db",
  "old mode 100644",
  "new mode 100755",
  "",
].join("\n");

describe("binaryPatchPaths", () => {
  it("names exactly the binary files in a mixed patch, the way the renderer names them", () => {
    const renderedNames = parsePatchFiles(patch).flatMap((parsed) =>
      parsed.files.map((file) => file.name),
    );
    const found = binaryPatchPaths(patch);
    // The badge must land on the strings the diff panel shows for those files. The renderer
    // reads an ambiguous header holding " b/" its own way, and this follows it.
    expect(found).toEqual(["résumé", "dir b/contains b/dir", "new-name.bin"]);
    for (const path of found) expect(renderedNames).toContain(path);
    expect(found).not.toContain("plain.txt");
    expect(found).not.toContain("notes.db");
  });

  it("returns nothing for a patch with only text changes", () => {
    expect(binaryPatchPaths(patch.split("diff --git a/plain.txt")[0] ?? "")).toEqual([]);
  });
});
