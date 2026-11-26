import { msg } from "gt-react";

import type { MessageResolver } from "~/i18n/messages";
import type { TurnFoldSummary } from "~/components/chat/MessagesTimeline.logic";

/**
 * Chat mode names the work behind an answer by what it was, not by how long it took:
 * "Used 3 tools · 8s" when tools ran, "Thought for 4s" when the agent only reasoned. A fold that
 * is neither (a stopped turn, or work of a kind this does not know) keeps its own label.
 */
export function chatFoldLabel(
  row: { readonly label: string; readonly summary?: TurnFoldSummary | undefined },
  resolve: MessageResolver,
): string {
  const summary = row.summary;
  if (summary === undefined) return row.label;
  const { duration, toolCount, thought } = summary;
  if (toolCount > 0) {
    return duration
      ? resolve(
          msg("{count, plural, one {Used # tool} other {Used # tools}} · {duration}", {
            count: toolCount,
            duration,
          }),
        )
      : resolve(
          msg("{count, plural, one {Used # tool} other {Used # tools}}", { count: toolCount }),
        );
  }
  if (thought) {
    return duration
      ? resolve(msg("Thought for {duration}", { duration }))
      : resolve(msg("Thought"));
  }
  return row.label;
}
