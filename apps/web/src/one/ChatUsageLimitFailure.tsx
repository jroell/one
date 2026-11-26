import { useGT } from "gt-react";

import { Button } from "~/components/ui/button";
import type { TimestampFormat } from "@t3tools/contracts";
import { formatUpcomingTimestamp } from "~/timestampFormat";

import type { UsageLimitRecovery } from "./chatUsageRecovery";

/**
 * What a Chat thread says when its model ran out of usage: which model could not answer, until
 * when, and what is ready. One button tries again with what is ready; changing the model is
 * quieter.
 */
export function ChatUsageLimitFailure({
  recovery,
  timestampFormat,
  busy,
  onTryAgain,
  onChangeModel,
}: {
  readonly recovery: UsageLimitRecovery;
  readonly timestampFormat: TimestampFormat;
  /** The retry is starting. */
  readonly busy: boolean;
  /** Absent when the run cannot be continued, so the person is not offered a button that fails. */
  readonly onTryAgain: (() => void) | null;
  readonly onChangeModel: () => void;
}) {
  const gt = useGT();
  const { failedModel, resetsAt, alternative } = recovery;
  const time = resetsAt ? formatUpcomingTimestamp(resetsAt, timestampFormat) : "";
  const model = failedModel;
  const provider = alternative?.providerName ?? "";
  const headline =
    time !== "" && alternative !== null
      ? gt(
          "{model} could not answer: its usage limit is reached until {time}. {provider} is ready.",
          {
            model,
            time,
            provider,
          },
        )
      : time !== ""
        ? gt("{model} could not answer: its usage limit is reached until {time}.", { model, time })
        : alternative !== null
          ? gt("{model} could not answer: its usage limit is reached. {provider} is ready.", {
              model,
              provider,
            })
          : gt("{model} could not answer: its usage limit is reached.", { model });
  return (
    <div className="chat-content-lane">
      <div role="alert" className="one-chat-failure" data-chat-usage-limit="" data-tone="warning">
        <p className="one-chat-failure-headline">{headline}</p>
        <div className="one-chat-failure-action one-chat-failure-buttons">
          {alternative !== null && onTryAgain !== null ? (
            <Button type="button" size="xs" variant="outline" disabled={busy} onClick={onTryAgain}>
              {busy
                ? gt("Trying again...")
                : gt("Try again with {provider}", { provider: alternative.providerName })}
            </Button>
          ) : null}
          <Button type="button" size="xs" variant="ghost-muted" onClick={onChangeModel}>
            {gt("Change model")}
          </Button>
        </div>
      </div>
    </div>
  );
}
