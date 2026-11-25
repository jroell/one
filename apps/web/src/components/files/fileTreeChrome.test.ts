import { describe, expect, it } from "vite-plus/test";

import { FILE_TREE_UNSAFE_CSS, fileTreeItemHeightOption } from "./fileTreeChrome";

describe("file tree row height", () => {
  it("gives the tree model the touch height instead of forcing it in CSS", () => {
    expect(fileTreeItemHeightOption(true)).toEqual({ itemHeight: 44 });
    expect(fileTreeItemHeightOption(false)).toEqual({});
    // A CSS min-height would make rows taller than the 24px the scroll model counts.
    expect(FILE_TREE_UNSAFE_CSS).not.toMatch(/min-height/);
  });
});
