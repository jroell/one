import { describe, expect, it } from "vite-plus/test";

import { diffFileTreePositions } from "@t3tools/client-runtime/diff-file-order";

import { compareReviewFiles } from "./reviewFileOrder";

const order = (files: ReadonlyArray<{ path: string; binary?: boolean }>) =>
  files.toSorted(compareReviewFiles).map((file) => file.path);

describe("compareReviewFiles", () => {
  it("lists a folder's files together with binaries last, and folders in path order", () => {
    expect(
      order([
        { path: "assets/logo.png", binary: true },
        { path: "src/lib/b.ts" },
        { path: "assets/app.ts" },
        { path: "src/z.ts" },
        { path: "assets/icon.png", binary: true },
        { path: "assets/a.ts" },
      ]),
    ).toEqual([
      "assets/a.ts",
      "assets/app.ts",
      "assets/icon.png",
      "assets/logo.png",
      "src/z.ts",
      "src/lib/b.ts",
    ]);
  });

  it("keeps a folder's subtree together when a sibling's name starts with the same letters", () => {
    expect(
      order([{ path: "a/root.ts" }, { path: "a-b/ext.ts" }, { path: "a/sub/part.ts" }]),
    ).toEqual(["a/root.ts", "a/sub/part.ts", "a-b/ext.ts"]);
  });

  it("puts binaries after text files in their own folder, before its subfolders", () => {
    expect(
      order([
        { path: "docs/img/shot.png", binary: true },
        { path: "docs/logo.png", binary: true },
        { path: "docs/intro.md" },
      ]),
    ).toEqual(["docs/intro.md", "docs/logo.png", "docs/img/shot.png"]);
  });

  it("gives the file tree the order of the list, so the two never disagree", () => {
    const files = order([
      { path: "a/root.ts" },
      { path: "a-b/ext.ts" },
      { path: "a/sub/part.ts" },
      { path: "a/zeta.png", binary: true },
      { path: "z.ts" },
    ]);
    expect(files).toEqual(["z.ts", "a/root.ts", "a/zeta.png", "a/sub/part.ts", "a-b/ext.ts"]);
    // The tree places a folder where its first file appears, so the folder `a` comes before
    // `a-b` and holds all three of its files.
    const positions = diffFileTreePositions(files);
    expect(positions.get("a/")).toBe(1);
    expect(positions.get("a/sub/")).toBe(3);
    expect(positions.get("a-b/")).toBe(4);
  });
});
