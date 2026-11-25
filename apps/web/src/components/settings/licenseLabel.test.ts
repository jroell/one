import { describe, expect, it } from "vite-plus/test";

import { licenseLabel } from "./licenseLabel";

describe("licenseLabel", () => {
  it("names the file a package points to instead of showing its pointer text", () => {
    expect(licenseLabel("SEE LICENSE IN README.md")).toEqual({ kind: "custom", file: "README" });
    expect(licenseLabel("SEE LICENSE IN LICENSE.txt")).toEqual({ kind: "custom", file: "LICENSE" });
    expect(licenseLabel("(SEE LICENSE IN EULA)")).toEqual({ kind: "custom", file: "EULA" });
  });

  it("drops the wrapping parentheses and shouted conjunctions of a license expression", () => {
    expect(licenseLabel("(Apache-2.0 AND BSD-3-Clause)")).toEqual({
      kind: "spdx",
      text: "Apache-2.0 + BSD-3-Clause",
    });
    expect(licenseLabel("(MIT OR Apache-2.0)")).toEqual({
      kind: "spdx",
      text: "MIT or Apache-2.0",
    });
    expect(licenseLabel("MIT")).toEqual({ kind: "spdx", text: "MIT" });
    expect(licenseLabel("GPL-2.0 WITH Classpath-exception-2.0")).toEqual({
      kind: "spdx",
      text: "GPL-2.0 WITH Classpath-exception-2.0",
    });
  });
});
