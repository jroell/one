// @effect-diagnostics nodeBuiltinImport:off - reads index.html on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

import { ONE_MARK_PATHS } from "./oneMarkPaths";

const html = NodeFS.readFileSync(
  NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../../index.html"),
  "utf8",
);

describe("boot screen mark", () => {
  it("draws every outline the One mark draws, so the two cannot drift apart", () => {
    const boot = html.slice(
      html.indexOf('id="boot-shell-logo"'),
      html.indexOf('id="boot-shell-name"'),
    );
    for (const [name, outline] of Object.entries(ONE_MARK_PATHS)) {
      expect(boot, `boot screen is missing the ${name} outline`).toContain(outline);
    }
  });
});
