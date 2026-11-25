import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

const MOVES = /\b(scale|translate|rotate|transform)\b/;

function allRules(rules: CSSRuleList, conditions: readonly string[], found: Array<Seen>): void {
  for (const rule of rules) {
    found.push({ rule, conditions });
    if ("cssRules" in rule) {
      const condition =
        rule instanceof CSSMediaRule
          ? rule.conditionText
          : rule instanceof CSSLayerBlockRule
            ? `layer ${rule.name}`
            : "";
      allRules(rule.cssRules as CSSRuleList, [...conditions, condition], found);
    }
  }
}

interface Seen {
  readonly rule: CSSRule;
  readonly conditions: readonly string[];
}

/** Every settings rule that moves something, with the media conditions around it. */
function movingSettingsRules(): Array<{ selector: string; guarded: boolean }> {
  const seen: Array<Seen> = [];
  for (const sheet of document.styleSheets) allRules(sheet.cssRules, [], seen);

  // Keyframes that move something, by name: a rule that runs one moves as well.
  const movingKeyframes = new Set(
    seen.flatMap(({ rule }) =>
      rule instanceof CSSKeyframesRule &&
      [...rule.cssRules].some(
        (frame) =>
          frame instanceof CSSKeyframeRule &&
          (frame.style.transform !== "" ||
            frame.style.scale !== "" ||
            frame.style.translate !== "" ||
            frame.style.rotate !== ""),
      )
        ? [rule.name]
        : [],
    ),
  );

  return seen.flatMap(({ rule, conditions }) => {
    if (!(rule instanceof CSSStyleRule)) return [];
    // Layered rules are shared base styles with their own owner; the settings sheet is unlayered.
    if (conditions.some((condition) => condition.startsWith("layer"))) return [];
    if (!/data-settings|settings-(slider|search-target)/.test(rule.selectorText)) return [];
    const { style } = rule;
    const runsMovingKeyframes = style.animationName
      .split(",")
      .some((name) => movingKeyframes.has(name.trim()));
    const set = (value: string) => value !== "" && value !== "none";
    const moves =
      set(style.scale) ||
      set(style.translate) ||
      set(style.rotate) ||
      set(style.transform) ||
      MOVES.test(style.transition) ||
      MOVES.test(style.transitionProperty) ||
      runsMovingKeyframes;
    return moves
      ? [
          {
            selector: rule.selectorText,
            guarded: conditions.some((c) => c.includes("no-preference")),
          },
        ]
      : [];
  });
}

describe("settings motion", () => {
  it("moves, scales or turns settings elements only when motion is allowed", () => {
    const rules = movingSettingsRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.filter((rule) => !rule.guarded).map((rule) => rule.selector)).toEqual([]);
  });
});
