// @effect-diagnostics nodeBuiltinImport:off - reads the stylesheet on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const css = NodeFS.readFileSync(
  NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "one-pages.css"),
  "utf8",
);

/** Every rule at any depth as "context selector { body }", comments removed. */
function rules(source: string, context = ""): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let prelude = "";
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "{") {
      if (depth === 0) {
        prelude = text.slice(start, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        const body = text.slice(start, i).trim();
        if (prelude.startsWith("@media") || prelude.startsWith("@variant")) {
          out.push(...rules(body, `${context}${prelude} `));
        } else {
          out.push(`${context}${prelude} { ${body.replace(/\s+/g, " ")} }`);
        }
        start = i + 1;
      }
    }
  }
  return out;
}

describe("one-pages.css", () => {
  it("declares each rule once, so a second copy cannot drift from the first", () => {
    const seen = new Map<string, number>();
    for (const rule of rules(css)) seen.set(rule, (seen.get(rule) ?? 0) + 1);
    const repeated = [...seen].filter(([, count]) => count > 1).map(([rule]) => rule);
    expect(repeated).toEqual([]);
  });
});
