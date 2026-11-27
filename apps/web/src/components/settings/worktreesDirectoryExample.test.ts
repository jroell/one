import { describe, expect, it } from "vite-plus/test";

import { worktreesDirectoryExample } from "./worktreesDirectoryExample";

describe("the sample worktree folder", () => {
  it("is written the way each machine's own system writes paths, and both when machines differ", () => {
    expect(worktreesDirectoryExample(["darwin"])).toBe("~/worktrees");
    expect(worktreesDirectoryExample(["linux", "darwin"])).toBe("~/worktrees");
    expect(worktreesDirectoryExample(["windows"])).toBe("D:\\worktrees");
    expect(worktreesDirectoryExample(["windows", "darwin"])).toBe("D:\\worktrees or ~/worktrees");
    expect(worktreesDirectoryExample([])).toBe("~/worktrees");
  });
});
