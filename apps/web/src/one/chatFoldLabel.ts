import { msg } from "gt-react";

import type { MessageResolver } from "~/i18n/messages";
import type { TurnFoldSummary } from "~/components/chat/MessagesTimeline.logic";

/**
 * Chat mode names the work behind an answer by what it was, in plain words with no file or
 * command language: "Looked at 2 sources", "Took 3 steps", "Thought for 4s". A fold that is
 * neither (a stopped turn, or work of a kind this does not know) keeps its own label.
 */
export function chatFoldLabel(
  row: { readonly label: string; readonly summary?: TurnFoldSummary | undefined },
  resolve: MessageResolver,
): string {
  const summary = row.summary;
  if (summary === undefined) return row.label;
  const { duration, toolCount, sourceCount, thought } = summary;
  if (toolCount > 0) {
    const steps = toolCount - sourceCount;
    const what =
      steps === 0
        ? resolve(
            msg("{count, plural, one {Looked at # source} other {Looked at # sources}}", {
              count: sourceCount,
            }),
          )
        : sourceCount === 0
          ? resolve(
              msg("{count, plural, one {Took # step} other {Took # steps}}", { count: steps }),
            )
          : resolve(
              msg(
                "{sources, plural, one {Looked at # source} other {Looked at # sources}}, {steps, plural, one {took # step} other {took # steps}}",
                { sources: sourceCount, steps },
              ),
            );
    return duration ? resolve(msg("{what} · {duration}", { what, duration })) : what;
  }
  if (thought) {
    return duration
      ? resolve(msg("Thought for {duration}", { duration }))
      : resolve(msg("Thought"));
  }
  return row.label;
}
