import { useGT } from "gt-react";
import { CheckIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import { use, useId, useState, type ReactNode } from "react";
import * as DateTime from "effect/DateTime";

import { McpSignInAction } from "~/components/chat/McpSignInAction";
import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { Button } from "~/components/ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import type { WorkLogEntry } from "~/session-logic";

function CopyDetailButton({ text, label }: { readonly text: string; readonly label: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <span className="one-chat-copy">
      <Button
        type="button"
        variant="ghost-muted"
        size="icon-xs"
        aria-label={label}
        onClick={() => copyToClipboard(text)}
      >
        {isCopied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </Button>
    </span>
  );
}

function noticeText(entry: WorkLogEntry): string {
  return entry.structuredPayload?.type === "system_notice"
    ? entry.structuredPayload.message
    : entry.label;
}

function noticeLevel(entry: WorkLogEntry): "info" | "warning" | "error" {
  return entry.structuredPayload?.type === "system_notice"
    ? (entry.structuredPayload.level ?? "warning")
    : "warning";
}

/**
 * A turn's non-blocking notices as one quiet line: "1 notice", with a dot for how serious the
 * worst is. It opens to the full text, wrapped and never cut off, with a copy button and any
 * sign-in the notice offers.
 */
export function ChatNoticeLine({ notices }: { readonly notices: ReadonlyArray<WorkLogEntry> }) {
  const gt = useGT();
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (notices.length === 0) return null;
  const levels = notices.map(noticeLevel);
  const worst = levels.includes("error")
    ? "error"
    : levels.includes("warning")
      ? "warning"
      : "info";
  return (
    <div className="one-chat-notice" data-chat-notice="" data-level={worst}>
      <button
        type="button"
        className="one-chat-notice-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        data-scroll-anchor-ignore
        onClick={() => setOpen((current) => !current)}
      >
        <span className="one-chat-notice-dot" aria-hidden />
        <span>
          {gt("{count, plural, one {# notice} other {# notices}}", { count: notices.length })}
        </span>
        <ChevronRightIcon className="one-chat-notice-chevron size-3.5" aria-hidden />
      </button>
      {open ? (
        <div id={bodyId} className="one-chat-notice-body">
          {notices.map((entry) => {
            const payload = entry.structuredPayload;
            return (
              <div key={entry.id}>
                <p className="one-chat-notice-text">{noticeText(entry)}</p>
                {payload?.type === "system_notice" &&
                payload.mcpSignIn !== undefined &&
                payload.providerThreadId !== null ? (
                  <McpSignInAction
                    environmentId={activeThreadEnvironmentId}
                    threadId={payload.threadId}
                    providerThreadId={payload.providerThreadId}
                    server={payload.mcpSignIn.server}
                    noticeAt={DateTime.toEpochMillis(payload.updatedAt)}
                  />
                ) : null}
              </div>
            );
          })}
          <CopyDetailButton
            text={notices.map(noticeText).join("\n\n")}
            label={gt("Copy notice text")}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * A turn that failed, in the voice of the answer: one plain sentence, and the technical text
 * behind a disclosure, wrapped, with a copy button.
 */
export function ChatFailure({
  headline,
  details,
  warning,
  action,
}: {
  readonly headline: string;
  /** The provider's own text; null when there is none worth showing. */
  readonly details: string | null;
  readonly warning: boolean;
  readonly action?: ReactNode;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div
      role="alert"
      className="one-chat-failure"
      data-chat-failure=""
      data-tone={warning ? "warning" : "error"}
    >
      <p className="one-chat-failure-headline">{headline}</p>
      {details !== null ? (
        <>
          <button
            type="button"
            className="one-chat-notice-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            data-scroll-anchor-ignore
            onClick={() => setOpen((current) => !current)}
          >
            <span>{gt("Technical details")}</span>
            <ChevronRightIcon className="one-chat-notice-chevron size-3.5" aria-hidden />
          </button>
          {open ? (
            <div id={bodyId} className="one-chat-notice-body">
              <p className="one-chat-notice-text">{details}</p>
              <CopyDetailButton text={details} label={gt("Copy technical details")} />
            </div>
          ) : null}
        </>
      ) : null}
      {action}
    </div>
  );
}
