import { getResolvedOrResolveTheme, registerCustomTheme, type DiffsTheme } from "@pierre/diffs";

import { readableOnLightCode } from "./readableSyntaxTheme";

export const ONE_DARK_THEME_NAME = "one-dark";
export const ONE_LIGHT_THEME_NAME = "one-light";

type ZedTheme = NonNullable<DiffsTheme["zed"]>;

/** The roles a code token plays, each with the highlighter scopes that carry it. */
const ROLE_SCOPES = {
  comment: ["comment", "comment.doc", "markup.strikethrough", "markup.quote", "hint"],
  string: [
    "string",
    "string.template",
    "template_string",
    "text.literal",
    "markup.raw",
    "markup.raw.inline",
    "markup.raw.block",
  ],
  escape: ["string.escape", "string.special"],
  regex: ["string.regex"],
  constant: [
    "string.special.symbol",
    "constant",
    "constant.css",
    "color",
    "constant.color",
    "variant",
    "number",
    "boolean",
    "value",
    "string.plain",
    "plain_value",
    "unit",
    "number.unit",
  ],
  keyword: [
    "keyword",
    "keyword.directive",
    "keyword.control.at-rule",
    "at_keyword",
    "keyword.important",
    "punctuation.special",
    "preproc",
    "markup.italic",
    "link_uri",
    "tag.css",
    "tag_name",
    "tag.jsx",
    "tag",
    "markup.heading",
    "markup.list",
    "markup.list.numbered",
    "markup.list.unnumbered",
    "title",
    "selector",
    "variable.builtin",
    "variable.special",
    "variable.language",
    "this",
    "self",
    "label",
    "namespace",
  ],
  operator: [
    "keyword.operator",
    "selector.pseudo",
    "pseudo_class_selector",
    "pseudo_element_selector",
    "operator",
  ],
  fn: [
    "function",
    "function.method",
    "function.builtin",
    "function.special.definition",
    "function.call",
    "selector.id",
    "id_name",
    "method_definition",
    "function.method.call",
    "markup.link.text",
  ],
  type: [
    "type",
    "type.builtin",
    "constructor",
    "type.class",
    "tag.component",
    "enum",
    "class",
    "class_name",
    "selector.class",
    "attribute",
  ],
  variable: [
    "variable",
    "variable.member",
    "property",
    "variable.scss",
    "variable.css",
    "property.custom",
    "property.object",
    "property_identifier",
    "shorthand_property_identifier",
    "shorthand_property_identifier_pattern",
    "embedded",
    "markup.bold",
  ],
  parameter: ["variable.parameter"],
  key: [
    "property.css",
    "property.definition",
    "property_name",
    "markup.link.url",
    "link_text",
    "primary",
  ],
  punctuation: [
    "punctuation",
    "punctuation.bracket",
    "punctuation.delimiter",
    "punctuation.list_marker",
  ],
  decorator: ["decorator", "attribute.builtin"],
} as const satisfies Record<string, ReadonlyArray<string>>;

type Role = keyof typeof ROLE_SCOPES;

/** Keywords gold, strings parchment, comments dim, types tan: warm neutrals with one gold. */
const ONE_DARK_PALETTE: Record<Role, string> = {
  comment: "#8a8170",
  string: "#e8dcc0",
  escape: "#f0cf86",
  regex: "#d9a56c",
  constant: "#e0966c",
  keyword: "#ddb55a",
  operator: "#a89f8c",
  fn: "#f3e9d2",
  type: "#c9b79a",
  variable: "#d9d2c3",
  parameter: "#bdb4a2",
  key: "#a9bc9a",
  punctuation: "#9c9382",
  decorator: "#c9a06a",
};

/** The same roles on a light surface, each at 4.5:1 or better on the darkest code background. */
export const ONE_LIGHT_PALETTE: Record<Role, string> = {
  comment: "#665e4f",
  string: "#5b4f2b",
  escape: "#7f4f00",
  regex: "#8a4b14",
  constant: "#9a4a12",
  keyword: "#7a5800",
  operator: "#635b4c",
  fn: "#1f1b14",
  type: "#5e4e33",
  variable: "#3b352a",
  parameter: "#5a5242",
  key: "#3f5b3a",
  punctuation: "#5f5748",
  decorator: "#7c5420",
};

type Finish = (color: string) => string;

function roleColors(palette: Record<Role, string>, finish: Finish): Map<string, string> {
  const colorOf = new Map<string, string>();
  for (const [role, scopes] of Object.entries(ROLE_SCOPES)) {
    for (const scope of scopes) colorOf.set(scope, finish(palette[role as Role]));
  }
  return colorOf;
}

function withPalette(
  base: ZedTheme,
  name: string,
  palette: Record<Role, string>,
  finish: Finish,
): ZedTheme {
  const colorOf = roleColors(palette, finish);
  const syntax = Object.fromEntries(
    Object.entries(base.style.syntax ?? {}).map(([scope, style]) => {
      const own = typeof style === "string" ? style : style.color;
      // A scope no role names (the diff colors) keeps its hue but meets the surface's floor.
      const color = colorOf.get(scope) ?? (own === undefined ? undefined : finish(own));
      if (color === undefined) return [scope, style];
      return [scope, typeof style === "string" ? color : { ...style, color }];
    }),
  );
  return { ...base, name, style: { ...base.style, syntax } };
}

/**
 * The base theme's color for each role, as the One color that replaces it. The TextMate theme
 * shares its palette with the Highlights one, so a color maps the way most of its scopes do.
 */
function replacementColors(
  base: ZedTheme,
  palette: Record<Role, string>,
  finish: Finish,
): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  const colorOf = roleColors(palette, finish);
  for (const [scope, style] of Object.entries(base.style.syntax ?? {})) {
    const next = colorOf.get(scope);
    const own = typeof style === "string" ? style : style.color;
    if (next === undefined || own === undefined) continue;
    const forColor = votes.get(own.toLowerCase()) ?? new Map<string, number>();
    forColor.set(next, (forColor.get(next) ?? 0) + 1);
    votes.set(own.toLowerCase(), forColor);
  }
  return new Map(
    [...votes].map(([own, forColor]) => [own, [...forColor].sort((a, b) => b[1] - a[1])[0]![0]]),
  );
}

/** Shiki's engine needs the same theme in TextMate form: each foreground is recolored. */
function withTextmatePalette(
  base: NonNullable<DiffsTheme["textmate"]>,
  name: string,
  replacements: ReadonlyMap<string, string>,
  finish: Finish,
): NonNullable<DiffsTheme["textmate"]> {
  const recolor = (color: string) => replacements.get(color.toLowerCase()) ?? finish(color);
  const settings = (base.settings ?? []).map((rule) => {
    const foreground = rule.settings.foreground;
    // The rule without a scope is the editor's own foreground and background.
    if (rule.scope === undefined || foreground === undefined) return rule;
    return { ...rule, settings: { ...rule.settings, foreground: recolor(foreground) } };
  });
  return { ...base, name, settings };
}

// Themes resolve on the main thread and reach the diff workers already resolved. Scopes outside
// the roles (diff colors, emphasis) keep the base theme's hue. Each theme is registered for both
// engines: Highlights (Zed) is the app's, and Shiki's TextMate form serves any caller on it.
function registerOneTheme(
  name: string,
  baseName: "pierre-dark" | "pierre-light",
  palette: Record<Role, string>,
  finish: Finish,
) {
  registerCustomTheme(
    name,
    async () => {
      const base = await getResolvedOrResolveTheme(baseName, "highlights");
      if (!base.zed) throw new Error(`${baseName} has no Highlights palette`);
      return withPalette(base.zed, name, palette, finish);
    },
    "zed",
  );
  registerCustomTheme(
    name,
    async () => {
      const [zed, textmate] = await Promise.all([
        getResolvedOrResolveTheme(baseName, "highlights"),
        getResolvedOrResolveTheme(baseName, "shiki-js"),
      ]);
      if (!zed.zed) throw new Error(`${baseName} has no Highlights palette`);
      if (!textmate.textmate) throw new Error(`${baseName} has no TextMate palette`);
      return withTextmatePalette(
        textmate.textmate,
        name,
        replacementColors(zed.zed, palette, finish),
        finish,
      );
    },
    "textmate",
  );
}

registerOneTheme(ONE_DARK_THEME_NAME, "pierre-dark", ONE_DARK_PALETTE, (color) => color);
registerOneTheme(ONE_LIGHT_THEME_NAME, "pierre-light", ONE_LIGHT_PALETTE, readableOnLightCode);
