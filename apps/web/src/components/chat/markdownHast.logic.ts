export function plainHastText(node: unknown): string | null {
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray(node.children)) {
    return null;
  }
  const parts = node.children.map((child) => {
    if (
      child &&
      typeof child === "object" &&
      "type" in child &&
      child.type === "text" &&
      "value" in child &&
      typeof child.value === "string"
    ) {
      return child.value;
    }
    return null;
  });
  return parts.every((part) => part !== null) ? parts.join("") : null;
}

export function hastPlainTextDeep(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  if ("type" in node && node.type === "text" && "value" in node && typeof node.value === "string") {
    return node.value;
  }
  if (!("children" in node) || !Array.isArray(node.children)) return "";
  return node.children.map(hastPlainTextDeep).join("");
}

export function hastHasText(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if (
    "type" in node &&
    node.type === "text" &&
    "value" in node &&
    typeof node.value === "string" &&
    node.value.trim().length > 0
  ) {
    return true;
  }
  return "children" in node && Array.isArray(node.children) && node.children.some(hastHasText);
}

/**
 * The alt text of a paragraph whose only content is one standalone image, which Chat mode sets
 * as a figure with the alt text as its caption. Null for any other paragraph, or an image with no
 * alt text.
 */
export function standaloneImageCaption(node: unknown): string | null {
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray(node.children)) {
    return null;
  }
  const meaningful = node.children.filter(
    (child) => !(child?.type === "text" && String(child.value ?? "").trim() === ""),
  );
  const only = meaningful.length === 1 ? meaningful[0] : undefined;
  if (only?.type !== "element" || only.tagName !== "img") return null;
  const properties = only.properties ?? {};
  if (properties.dataStandalone !== true) return null;
  const alt = typeof properties.alt === "string" ? properties.alt.trim() : "";
  return alt === "" ? null : alt;
}

/**
 * A paragraph that is one bold run from end to end, such as a closing summary. Chat mode sets it
 * as a statement in a medium weight, since a whole paragraph of bold reads as shouting.
 */
export function isWhollyBoldParagraph(node: unknown): boolean {
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray(node.children)) {
    return false;
  }
  const meaningful = node.children.filter(
    (child) => !(child?.type === "text" && String(child.value ?? "").trim() === ""),
  );
  const only = meaningful.length === 1 ? meaningful[0] : undefined;
  return only?.type === "element" && only.tagName === "strong" && hastHasText(only);
}
