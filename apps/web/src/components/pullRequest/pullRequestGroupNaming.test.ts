import { describe, expect, it } from "vite-plus/test";

import { pullRequestGroupNaming } from "./PullRequestListGroups";

describe("pull request group names", () => {
  it("calls the only group the whole list, and the rest beside other groups everyone else", () => {
    expect(pullRequestGroupNaming("others", true)).toBe("all");
    expect(pullRequestGroupNaming("others", false)).toBe("everyone-else");
  });

  it("keeps the reason a group is named for when it is not the rest", () => {
    expect(pullRequestGroupNaming("reviewRequested", true)).toBe("label");
    expect(pullRequestGroupNaming("authored", false)).toBe("label");
  });
});
