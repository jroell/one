import { useRouter } from "@tanstack/react-router";
import type { TimestampFormat } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ArrowRightIcon } from "lucide-react";

import { formatUpcomingTimestamp } from "~/timestampFormat";

import type { GuidedThreadInfo } from "./guidedThread";

/**
 * What a guided thread says about itself, in the order a person reads it: once the turn has an
 * answer, links to the places it names (they leave the conversation, so they are links with an
 * arrow, never pills), then which provider answered, last and quietest.
 */
export function GuidedThreadFooter({
  info,
  answered,
  timestampFormat,
}: {
  readonly info: GuidedThreadInfo;
  readonly answered: boolean;
  readonly timestampFormat: TimestampFormat;
}) {
  const gt = useGT();
  const router = useRouter();
  const { asked, skipped } = info;
  const time =
    skipped?.resetsAt != null ? formatUpcomingTimestamp(skipped.resetsAt, timestampFormat) : "";
  const line =
    skipped === undefined
      ? gt("Asked {asked}.", { asked })
      : time !== ""
        ? gt("Asked {asked}: {skipped} is out until {time}.", {
            asked,
            skipped: skipped.name,
            time,
          })
        : gt("Asked {asked}: {skipped} is out of usage.", { asked, skipped: skipped.name });
  return (
    <div data-guided-footer="">
      {answered && info.actions.length > 0 ? (
        <nav className="one-guided-links" aria-label={gt("Open what this names")}>
          {info.actions.map((action) => (
            <button
              key={action.href}
              type="button"
              className="one-guided-link"
              onClick={() => void router.navigate({ href: action.href })}
            >
              <span>{action.label}</span>
              <ArrowRightIcon aria-hidden className="size-3.5" />
            </button>
          ))}
        </nav>
      ) : null}
      <p className="one-guided-line">{line}</p>
    </div>
  );
}
