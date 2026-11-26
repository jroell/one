import { useGT } from "gt-react";
import { CheckIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import { use, useId, useState, type ReactNode } from "react";
import * as DateTime from "effect/DateTime";

import { McpSignInAction } from "~/components/chat/McpSignInAction";
import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { Button } from "~/components/ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import type { WorkLogEntry } from "~/session-logic";

import { noticeKind, noticeLevel, signInOf, type ChatNoticeRowPlan } from "./chatNotices";

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

/** `plugin:exa:exa` reads as "Exa"; the plugin's name follows when two tools share a name. */
function toolLabels(servers: ReadonlyArray<string>): ReadonlyArray<string> {
  const parts = servers.map((server) => {
    const segments = server.split(":");
    const name = (segments.at(-1) ?? server).replace(/[_-]+/g, " ").trim();
    return { name: name.charAt(0).toUpperCase() + name.slice(1), plugin: segments.at(-2) ?? null };
  });
  return parts.map(({ name, plugin }) =>
    plugin !== null && parts.filter((other) => other.name === name).length > 1
      ? `${name} (${plugin})`
      : name,
  );
}

/**
 * Tools the turn never called that need a sign-in, as one quiet line that opens to a list with a
 * sign-in beside each. Never an alert: the person asked for none of them.
 */
function ChatSignInLine({ notices }: { readonly notices: ReadonlyArray<WorkLogEntry> }) {
  const gt = useGT();
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const rows = notices.flatMap((entry) => {
    const signIn = signInOf(entry);
    const payload = entry.structuredPayload;
    return signIn !== null && payload?.type === "system_notice" && payload.providerThreadId !== null
      ? [{ entry, server: signIn.server, payload, providerThreadId: payload.providerThreadId }]
      : [];
  });
  const labels = toolLabels(rows.map((row) => row.server));
  return (
    <div className="one-chat-notice" data-level="info" data-chat-sign-in-line="">
      <button
        type="button"
        className="one-chat-notice-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        data-scroll-anchor-ignore
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          {gt(
            "{count, plural, one {{count} tool needs sign-in} other {{count} tools need sign-in}}",
            {
              count: rows.length,
            },
          )}
        </span>
        <ChevronRightIcon className="one-chat-notice-chevron size-3.5" aria-hidden />
      </button>
      {open ? (
        <ul id={bodyId} className="one-chat-notice-body one-chat-signin-list">
          {rows.map((row, index) => (
            <li key={row.entry.id} className="one-chat-signin-row">
              <span className="one-chat-notice-text">{labels[index]}</span>
              <McpSignInAction
                environmentId={activeThreadEnvironmentId}
                threadId={row.payload.threadId}
                providerThreadId={row.providerThreadId}
                server={row.server}
                noticeAt={DateTime.toEpochMillis(row.payload.updatedAt)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A turn's notices in Chat. What the request needed (an error, a sign-in for a tool it called)
 * is in view as one plain sentence with its action. The tools it did not call fold into one quiet
 * line, and a thread the app started with hidden notes (a guided conversation) shows none of them. The rest wait behind the header's dot.
 */
export function ChatNoticeLine({ plan }: { readonly plan: ChatNoticeRowPlan }) {
  const needed = plan.notices.filter((entry) => noticeKind(entry, plan.usedServers) === "needed");
  const signIns = plan.notices.filter((entry) => noticeKind(entry, plan.usedServers) === "sign-in");
  return (
    <>
      {needed.map((entry) => (
        <ChatActionableNotice key={entry.id} entry={entry} />
      ))}
      {signIns.length > 0 && !plan.fromApp ? <ChatSignInLine notices={signIns} /> : null}
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
