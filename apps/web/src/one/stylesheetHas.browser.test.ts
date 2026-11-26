import "~/index.css";
import { expect, it } from "vite-plus/test";

/** Every style rule in the app's loaded stylesheets, with its selector, nested rules included. */
function selectors(): string[] {
  const found: string[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) found.push(rule.selectorText);
      if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      // A cross-origin sheet cannot be read, and holds none of ours.
    }
  }
  return found;
}

/** The compound selectors of a selector list, split outside parentheses. */
function compounds(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of selector) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (
      depth === 0 &&
      (char === " " || char === ">" || char === "+" || char === "~" || char === ",")
    ) {
      if (current) out.push(current);
      current = "";
    } else current += char;
  }
  if (current) out.push(current);
  return out;
}

it("has no :has() rule whose subject is html, body, :root, #root or any element", () => {
  // A :has() subject that matches everything, or the root, makes the browser re-check every ancestor
  // after each node a commit inserts or removes, and restyle the whole document: a thread switch
  // went from 60ms to 250ms of style recalculation that way. A script-set attribute does the same job.
  const offenders = selectors().filter((selector) =>
    compounds(selector).some(
      (part) => part.includes(":has(") && /^(html|body|:root|#root|\*|:has\()/.test(part),
    ),
  );
  expect(offenders).toEqual([]);
});

it("keys the composer's banner styles on data-banner-attached, not on :has() of the banner", () => {
  // ComposerSurface sets data-banner-attached on the shell; a :has() of the banner on the composer
  // host cost the palette's open about 3,000 restyled elements. The dock's own `not-has-data-`
  // utility is one element hiding itself, a leaf that stays.
  const offenders = selectors().filter(
    (selector) =>
      selector.includes('composer-banner-surface="attached"') &&
      selector.includes(":has(") &&
      !selector.startsWith(".not-has-data-"),
  );
  expect(offenders).toEqual([]);
});

const cleaned = import.meta.glob(
  ["../components/chat/ComposerSurface.tsx", "../components/chat/ComposerBanner.tsx"],
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
) as Record<string, string>;

// Leaves left on purpose (each scoped to one control, and measured at no cost):
//   ComposerBanner.tsx  not-has-data-[composer-banner-surface=attached]:hidden  (the dock itself)
//   ComposerBanner.tsx  [&:has(+[data-slot=composer-banner-attachment])]       (a banner and its next sibling)
const ALLOWED_GROUP_HAS: ReadonlyArray<string> = [
  // Each banner row styles its own padding from whether it has an icon or actions child (child
  // combinator, one row): a leaf.
  "group-not-has-[>[data-slot=composer-banner-icon]]/banner-row:col-[1/3]",
  "group-not-has-[>[data-slot=composer-banner-icon]]/banner-row:ps-2",
  "group-not-has-[>[data-slot=composer-banner-icon]]/banner-row:ps-1.5",
  "group-not-has-[>[data-slot=composer-banner-icon],>[data-slot=composer-banner-actions]]/banner-row:pe-2",
  "group-not-has-[>[data-slot=composer-banner-icon],>[data-slot=composer-banner-actions]]/banner-row:pe-1.5",
];

it("the composer files use no group-has-* utility except the leaves listed here", () => {
  const found = Object.entries(cleaned).flatMap(([file, text]) =>
    [...text.matchAll(/group-(?:not-)?has-[^\s"'`]+/g)]
      .map((match) => match[0])
      .filter((utility) => !ALLOWED_GROUP_HAS.includes(utility))
      .map((utility) => `${file}: ${utility}`),
  );
  expect(found).toEqual([]);
});
