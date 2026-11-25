import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

/** Every settings rule that moves or scales something, with the media conditions around it. */
function movingSettingsRules(): Array<{ selector: string; guarded: boolean }> {
  const found: Array<{ selector: string; guarded: boolean }> = [];
  const walk = (rules: CSSRuleList, conditions: readonly string[]) => {
    for (const rule of rules) {
      const inner = "cssRules" in rule ? (rule.cssRules as CSSRuleList) : null;
      if (rule instanceof CSSStyleRule) {
        const isSettings = /data-settings-(nav|card|choice)/.test(rule.selectorText);
        const moves =
          rule.style.scale !== "" ||
          rule.style.translate !== "" ||
          /\b(scale|translate)\b/.test(rule.style.transition) ||
          /\b(scale|translate)\b/.test(rule.style.transitionProperty);
        if (isSettings && moves) {
          found.push({
            selector: rule.selectorText,
            guarded: conditions.some((condition) => condition.includes("no-preference")),
          });
        }
      }
      if (inner) {
        const condition = rule instanceof CSSMediaRule ? rule.conditionText : "";
        walk(inner, [...conditions, condition]);
      }
    }
  };
  for (const sheet of document.styleSheets) walk(sheet.cssRules, []);
  return found;
}

describe("settings motion", () => {
  it("scales and shifts navigation items, cards and choice rows only when motion is allowed", () => {
    const rules = movingSettingsRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.filter((rule) => !rule.guarded).map((rule) => rule.selector)).toEqual([]);
  });
});
