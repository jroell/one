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

function withPalette(
  base: ZedTheme,
  name: string,
  palette: Record<Role, string>,
  finish: (color: string) => string,
): ZedTheme {
  const colorOf = new Map<string, string>();
  for (const [role, scopes] of Object.entries(ROLE_SCOPES)) {
    for (const scope of scopes) colorOf.set(scope, finish(palette[role as Role]));
  }
  const syntax = Object.fromEntries(
    Object.entries(base.style.syntax ?? {}).map(([scope, style]) => {
      const color = colorOf.get(scope);
      if (color === undefined) return [scope, style];
      return [scope, typeof style === "string" ? color : { ...style, color }];
    }),
  );
  return { ...base, name, style: { ...base.style, syntax } };
}

// Themes resolve on the main thread and reach the diff workers already resolved. Scopes that
// carry diff colors and emphasis keep the base theme's values.
registerCustomTheme(
  ONE_DARK_THEME_NAME,
  async () => {
    const base = await getResolvedOrResolveTheme("pierre-dark", "highlights");
    if (!base.zed) throw new Error("pierre-dark has no Highlights palette");
    return withPalette(base.zed, ONE_DARK_THEME_NAME, ONE_DARK_PALETTE, (color) => color);
  },
  "zed",
);

registerCustomTheme(
  ONE_LIGHT_THEME_NAME,
  async () => {
    const base = await getResolvedOrResolveTheme("pierre-light", "highlights");
    if (!base.zed) throw new Error("pierre-light has no Highlights palette");
    return withPalette(base.zed, ONE_LIGHT_THEME_NAME, ONE_LIGHT_PALETTE, readableOnLightCode);
  },
  "zed",
);
