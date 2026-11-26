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

/** A notice the person must act on: a sign-in the notice offers, or an error. */
export function isActionableNotice(entry: WorkLogEntry): boolean {
  const payload = entry.structuredPayload;
  if (payload?.type !== "system_notice") return false;
  return (
    (payload.mcpSignIn !== undefined && payload.providerThreadId !== null) ||
    noticeLevel(entry) === "error"
  );
}

/** One notice that needs the person: a plain sentence, its sign-in beside it, the text behind it. */
function ChatActionableNotice({ entry }: { readonly entry: WorkLogEntry }) {
  const gt = useGT();
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  const payload = entry.structuredPayload;
  const signIn =
    payload?.type === "system_notice" &&
    payload.mcpSignIn !== undefined &&
    payload.providerThreadId !== null
      ? { payload, server: payload.mcpSignIn.server, providerThreadId: payload.providerThreadId }
      : null;
  return (
    <ChatFailure
      headline={
        signIn !== null
          ? gt("{server} could not start because it needs you to sign in.", {
              server: signIn.server,
            })
          : gt("Something needs your attention.")
      }
      details={noticeText(entry)}
      warning={noticeLevel(entry) !== "error"}
      action={
        signIn !== null ? (
          <div className="one-chat-failure-action">
            <McpSignInAction
              environmentId={activeThreadEnvironmentId}
              threadId={signIn.payload.threadId}
              providerThreadId={signIn.providerThreadId}
              server={signIn.server}
              noticeAt={DateTime.toEpochMillis(signIn.payload.updatedAt)}
            />
          </div>
        ) : undefined
      }
    />
  );
}

/**
 * A turn's notices that the person must act on (a sign-in, an error), each in view as one plain
 * sentence with its action beside it. The rest are quiet and live behind the header's status dot.
 */
export function ChatNoticeLine({ notices }: { readonly notices: ReadonlyArray<WorkLogEntry> }) {
  return (
    <>
      {notices.filter(isActionableNotice).map((entry) => (
        <ChatActionableNotice key={entry.id} entry={entry} />
      ))}
    </>
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
