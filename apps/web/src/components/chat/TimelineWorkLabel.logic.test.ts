import { describe, expect, it } from "vite-plus/test";

import { abbreviateHomePath, splitObjectPath, splitWorkLabel } from "./TimelineWorkLabel.logic";

describe("splitWorkLabel", () => {
  it("finds the path a row acts on inside its translated label", () => {
    expect(
      splitWorkLabel("Read apps/web/src/index.css", ["apps/web/src/index.css", "other"]),
    ).toEqual({ before: "Read ", object: "apps/web/src/index.css", after: "" });
  });

  it("prefers the longest matching object and falls back to a backtick span", () => {
    expect(splitWorkLabel("Edited src/a.ts and src/a.tsx", ["src/a.ts", "src/a.tsx"])?.object).toBe(
      "src/a.tsx",
    );
    expect(splitWorkLabel("Ran `vp test run` in server", [])).toEqual({
      before: "Ran ",
      object: "vp test run",
      after: " in server",
    });
    expect(splitWorkLabel("Thought for a moment", ["src/a.ts"])).toBeNull();
  });
});

describe("splitObjectPath", () => {
  it("keeps the file name whole so only the directory truncates", () => {
    expect(splitObjectPath("apps/web/src/index.css")).toEqual({
      dir: "apps/web/src/",
      base: "index.css",
    });
    expect(splitObjectPath("index.css")).toEqual({ dir: "", base: "index.css" });
  });
});

describe("abbreviateHomePath", () => {
  it("shows a path under a home folder as ~, and leaves other paths alone", () => {
    expect(abbreviateHomePath("/Users/ada/projects/one/a.ts")).toBe("~/projects/one/a.ts");
    expect(abbreviateHomePath("/home/ada/src/a.ts")).toBe("~/src/a.ts");
    expect(abbreviateHomePath("/opt/tools/a.ts")).toBe("/opt/tools/a.ts");
    expect(abbreviateHomePath("src/Users/ada/a.ts")).toBe("src/Users/ada/a.ts");
  });
});
