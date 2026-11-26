import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import {
  buildDiffFileTreeUpdates,
  diffFileTreeEntries,
  diffFileTreeModel,
} from "./diffFileTree.logic";

function file(type: FileDiffMetadata["type"], name: string, prevName = name): FileDiffMetadata {
  return { type, name, prevName } as FileDiffMetadata;
}

describe("diffFileTreeEntries", () => {
  it("folds a file-to-symlink type change into one modified entry", () => {
    expect(
      diffFileTreeEntries([
        file("change", "CLAUDE.md"),
        file("deleted", "AGENTS.md"),
        file("new", "AGENTS.md"),
        file("new", "docs/new.md"),
      ]),
    ).toEqual([
      { path: "CLAUDE.md", status: "modified" },
      { path: "AGENTS.md", status: "modified" },
      { path: "docs/new.md", status: "added" },
    ]);
  });
});

describe("buildDiffFileTreeUpdates", () => {
  it("adds a new file's directories before the file", () => {
    expect(buildDiffFileTreeUpdates(["README.md"], ["README.md", "src/lib/a.ts"])).toEqual([
      { type: "add", path: "src/" },
      { type: "add", path: "src/lib/" },
      { type: "add", path: "src/lib/a.ts" },
    ]);
  });

  it("removes files before their now-empty directories, deepest first", () => {
    expect(buildDiffFileTreeUpdates(["src/lib/a.ts", "src/b.ts"], ["src/b.ts"])).toEqual([
      { type: "remove", path: "src/lib/a.ts" },
      { type: "remove", path: "src/lib/", recursive: true },
    ]);
  });
});

describe("diffFileTreeModel", () => {
  it("draws the changed files' icons in one flat color, with or without a file that is also a folder", () => {
    expect(diffFileTreeModel(["src/a.ts", "logo.png"]).icons).toMatchObject({ colored: false });
    // The app's own sprite colors a test badge red and pnpm orange; none of it survives.
    expect(diffFileTreeModel(["a.test.ts"]).icons.spriteSheet).not.toMatch(
      /light-dark\(|style="color:|(?:fill|stroke)="#/,
    );
    const withAlias = diffFileTreeModel(["src", "src/a.ts"]);
    expect(withAlias.icons).toMatchObject({ colored: false });
    expect(
      Object.keys(withAlias.icons.byFileName ?? {}).some((name) => name.startsWith("src")),
    ).toBe(true);
  });
});
