function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The text of one known envelope: `{type:"text", text}` or `{type:"content", content:<that>}`.
 * A block with any other field is not an envelope this knows, so its fields stay visible.
 */
function envelopeText(block: unknown): string | null {
  const record = asRecord(block);
  if (record === null) return null;
  if (record.type === "text" && typeof record.text === "string") {
    return hasOnlyKeys(record, ["type", "text"]) ? record.text : null;
  }
  if (record.type === "content" && hasOnlyKeys(record, ["type", "content"])) {
    return envelopeText(record.content);
  }
  return null;
}

/**
 * A tool call's result can arrive as serialized content blocks with every newline escaped.
 * That happens only on a dynamic tool item, so only that item type is decoded, and only when it
 * is made entirely of the known blocks. Command output is whatever the command printed: a
 * command that prints this same JSON gets it back exactly.
 */
export function toolOutputDisplayText(output: string, itemType: string): string {
  if (itemType !== "dynamic_tool") return output;
  const trimmed = output.trim();
  if (trimmed.length < 2 || (trimmed[0] !== "[" && trimmed[0] !== "{")) return output;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return output;
  }
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  if (blocks.length === 0) return output;
  const texts = blocks.map(envelopeText);
  return texts.every((text): text is string => text !== null) ? texts.join("\n") : output;
}
