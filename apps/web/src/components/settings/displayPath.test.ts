import { describe, expect, it } from "vite-plus/test";

import { displayPath } from "./displayPath";

describe("displayPath", () => {
  it("writes the home folder as ~ and leaves other paths alone", () => {
    expect(displayPath("/Users/jasonroell/.t3/scratch")).toBe("~/.t3/scratch");
    expect(displayPath("/home/ana/projects/server")).toBe("~/projects/server");
    expect(displayPath("/Users/ana")).toBe("~");
    expect(displayPath("C:\\Users\\ana\\code\\app")).toBe("~\\code\\app");
    expect(displayPath("/srv/work/app")).toBe("/srv/work/app");
    expect(displayPath("/Users/anabel/x")).toBe("~/x");
  });
});
