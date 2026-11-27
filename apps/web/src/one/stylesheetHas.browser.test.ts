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

/**
 * Selectors with a `:has()` on an ancestor, followed by a combinator and more selector, such as
 * `:is(.group\/row:has(:focus-visible) *)` (Tailwind's `group-has-*` and `has-*:*:`) or
 * `:where(dialog:has(footer)) .x`. The `:has()` is not on the styled element.
 */
function ancestorHasRules(): string[] {
  return selectors().filter((selector) => {
    let from = 0;
    for (;;) {
      const start = selector.indexOf(":has(", from);
      if (start === -1) return false;
      let depth = 0;
      let end = start + 4;
      for (; end < selector.length; end += 1) {
        if (selector[end] === "(") depth += 1;
        if (selector[end] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      let next = end + 1;
      while (selector[next] === ")") next += 1;
      if (/^(\s|[>+~])\s*[^\s,]/.test(selector.slice(next))) return true;
      from = end;
    }
  });
}

// With 62 such rules the production build restyled 57,500 elements (330 ms) when the palette
// opened, against 10,900 (70 ms) with none. An attribute, tag or structure argument costs it on
// its own, so none is allowed: set a data attribute or a variable on the element that knows.
it("has no :has() on an ancestor in front of a combinator, which restyles the page on every DOM change", () => {
  expect(ancestorHasRules()).toEqual([]);
});

const cleaned = import.meta.glob(
  ["../components/chat/ComposerSurface.tsx", "../components/chat/ComposerBanner.tsx"],
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
) as Record<string, string>;

// Left on purpose: not-has-data-[composer-banner-surface=attached]:hidden (the dock itself) and
// [&:has(+[data-slot=composer-banner-attachment])] (a banner and its next sibling); each is the
// :has() on the styled element, which costs nothing.
it("the composer files use no group-has-* or group-not-has-* utility", () => {
  const found = Object.entries(cleaned).flatMap(([file, text]) =>
    [...text.matchAll(/group-(?:not-)?has-[^\s"'`]+/g)].map((match) => `${file}: ${match[0]}`),
  );
  expect(found).toEqual([]);
});
