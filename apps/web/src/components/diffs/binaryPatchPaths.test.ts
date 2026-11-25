import { describe, expect, it } from "vite-plus/test";

import { binaryPatchPaths } from "./binaryPatchPaths";

describe("binaryPatchPaths", () => {
  it("returns the files Git's own patch marks binary and none of the text files", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1..2 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/assets/logo.png b/assets/logo.png",
      "index 3..4 100644",
      "Binary files a/assets/logo.png and b/assets/logo.png differ",
      "diff --git a/firmware b/firmware",
      "index 5..6 100755",
      "GIT binary patch",
      "literal 12",
      "diff --git a/notes.db b/notes.db",
      "old mode 100644",
      "new mode 100755",
      "",
    ].join("\n");
    expect(binaryPatchPaths(patch)).toEqual(["assets/logo.png", "firmware"]);
  });
});
