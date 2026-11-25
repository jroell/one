import { describe, expect, it } from "vite-plus/test";

import { compareReviewFiles } from "./reviewFileOrder";

describe("compareReviewFiles", () => {
  it("lists a folder's files together with binaries last, and folders in path order", () => {
    const files = [
      { path: "assets/logo.png", binary: true },
      { path: "src/lib/b.ts" },
      { path: "assets/app.ts" },
      { path: "src/z.ts" },
      { path: "assets/icon.png", binary: true },
      { path: "assets/a.ts" },
    ];
    expect(files.toSorted(compareReviewFiles).map((file) => file.path)).toEqual([
      "assets/a.ts",
      "assets/app.ts",
      "assets/icon.png",
      "assets/logo.png",
      "src/z.ts",
      "src/lib/b.ts",
    ]);
  });
});
