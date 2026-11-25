function contentBlockText(block: unknown): string | null {
  if (block === null || typeof block !== "object") return null;
  const record = block as Record<string, unknown>;
  if (record.type === "text" && typeof record.text === "string") return record.text;
  if (record.type === "content") return contentBlockText(record.content);
  return null;
}

/**
 * Some providers return tool output as serialized content blocks, so a read of a file arrives
 * as `[{"type":"content","content":{"type":"text","text":"..."}}]` with every newline escaped.
 * This returns the readable text for display. Anything else comes back unchanged.
 */
export function toolOutputDisplayText(output: string): string {
  const trimmed = output.trim();
  if (trimmed.length < 2 || (trimmed[0] !== "[" && trimmed[0] !== "{" && trimmed[0] !== '"')) {
    return output;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return output;
  }
  if (typeof parsed === "string") return parsed;
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  if (blocks.length === 0) return output;
  const texts = blocks.map(contentBlockText);
  return texts.every((text): text is string => text !== null) ? texts.join("\n") : output;
}
