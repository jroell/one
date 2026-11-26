import { T, useGT, Var } from "gt-react";
import { useId, useState, type ReactNode } from "react";
import { use } from "react";

import { approvalHeaderVerb, approvalVerb } from "~/components/chat/approvalChanges";
import { TimelinePendingApprovalRow } from "~/components/chat/TimelinePendingApprovalRow";
import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { InlineButton } from "~/components/ui/button";
import type { PendingApproval } from "~/session-logic";

import {
  ApprovalSubjectContext,
  isGenericFileChangePrompt,
  relativeToWorkspace,
  type ApprovalSubject,
} from "./chatApprovalSubject";
import { useWorkspaceMode } from "./workspaceMode";

/** A request for permission, as the timeline shows it: the card in Code mode, a sentence in Chat. */
export function ApprovalRow({ approval }: { readonly approval: PendingApproval }) {
  const chatMode = useWorkspaceMode() === "chat";
  return chatMode ? (
    <ChatApproval approval={approval} />
  ) : (
    <TimelinePendingApprovalRow approval={approval} />
  );
}

const SENTENCE_COMMAND_LIMIT = 60;

/** The first line of a command, short enough for a sentence. */
function shortCommand(detail: string): string {
  const line =
    detail
      .split("\n")
      .find((part) => part.trim().length > 0)
      ?.trim() ?? "";
  return line.length > SENTENCE_COMMAND_LIMIT
    ? `${line.slice(0, SENTENCE_COMMAND_LIMIT - 1)}…`
    : line;
}

function Code({ children }: { readonly children: ReactNode }) {
  return <code className="one-chat-approval-code">{children}</code>;
}

/**
 * What is being asked, in plain words and from the same data the Code card's title reads: the
 * command itself, the file and how many lines change, or the number of files.
 */
function ApprovalSentence({
  approval,
  subject,
  workspaceRoot,
}: {
  readonly approval: PendingApproval;
  readonly subject: ApprovalSubject | undefined;
  readonly workspaceRoot: string | undefined;
}) {
  const gt = useGT();
  if (approval.requestKind === "command") {
    const command = shortCommand(approval.detail ?? "");
    return command.length > 0 ? (
      <T>
        Run{" "}
        <Code>
          <Var>{command}</Var>
        </Code>
        ?
      </T>
    ) : (
      gt("Run a command?")
    );
  }
  if (approval.requestKind === "file-change") {
    if (subject === undefined) {
      const named = isGenericFileChangePrompt(approval.detail) ? null : approval.detail;
      return named !== null && named !== undefined ? (
        <T>
          Change <Var>{named}</Var>?
        </T>
      ) : (
        gt("Change some files?")
      );
    }
    const files = subject.changes.length;
    if (files > 1) {
      const verb = approvalHeaderVerb(subject.changes);
      return verb === "add"
        ? gt("Add {count} files?", { count: files })
        : verb === "delete"
          ? gt("Delete {count} files?", { count: files })
          : verb === "rename"
            ? gt("Rename {count} files?", { count: files })
            : verb === "edit"
              ? gt("Edit {count} files?", { count: files })
              : gt("Change {count} files?", { count: files });
    }
    const only = subject.changes[0];
    const path = relativeToWorkspace(only?.path ?? subject.path, workspaceRoot);
    const verb = only === undefined ? "edit" : approvalVerb(only);
    if (verb === "add") {
      return (
        <T>
          Add{" "}
          <Code>
            <Var>{path}</Var>
          </Code>
          ?
        </T>
      );
    }
    if (verb === "delete") {
      return (
        <T>
          Delete{" "}
          <Code>
            <Var>{path}</Var>
          </Code>
          ?
        </T>
      );
    }
    if (verb === "rename") {
      const from = relativeToWorkspace(only?.oldPath ?? "", workspaceRoot);
      return (
        <T>
          Rename{" "}
          <Code>
            <Var>{from}</Var>
          </Code>{" "}
          to{" "}
          <Code>
            <Var>{path}</Var>
          </Code>
          ?
        </T>
      );
    }
    const added = subject.additions ?? 0;
    const removed = subject.deletions ?? 0;
    const counts =
      added > 0 && removed > 0
        ? gt("{added, plural, one {# line} other {# lines}} added, {removed} removed", {
            added,
            removed,
          })
        : added > 0
          ? gt("{count, plural, one {# line} other {# lines}} added", { count: added })
          : removed > 0
            ? gt("{count, plural, one {# line} other {# lines}} removed", { count: removed })
            : null;
    return counts === null ? (
      <T>
        Change{" "}
        <Code>
          <Var>{path}</Var>
        </Code>
        ?
      </T>
    ) : (
      <T>
        Change{" "}
        <Code>
          <Var>{path}</Var>
        </Code>
        : <Var>{counts}</Var>?
      </T>
    );
  }
  if (approval.requestKind === "file-read") {
    const path = relativeToWorkspace(approval.detail ?? "", workspaceRoot);
    return path.length > 0 ? (
      <T>
        Read{" "}
        <Code>
          <Var>{path}</Var>
        </Code>
        ?
      </T>
    ) : (
      gt("Read a file?")
    );
  }
  if (approval.appName) {
    return (
      <T>
        Give <Var>{approval.appName}</Var> access?
      </T>
    );
  }
  return approval.detail ? <Var>{approval.detail}</Var> : gt("Allow this?");
}

/**
 * In Chat mode a request is one sentence that names what is asked, with Approve and Decline
 * directly under it at the column's left edge. What would change waits behind one quiet link. The
 * card is the same component Code mode uses; Chat only decides how much of it shows, and a
 * resolved request leaves with the card's own motion.
 */
function ChatApproval({ approval }: { readonly approval: PendingApproval }) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const { leavingApprovals, workspaceRoot } = use(TimelineRowCtx);
  const subject = use(ApprovalSubjectContext).get(approval.requestId);
  const leaving = leavingApprovals?.has(approval.requestId) === true;
  const reveal =
    approval.requestKind === "command"
      ? [gt("Show command"), gt("Hide command")]
      : approval.requestKind === "file-change"
        ? [gt("Show change"), gt("Hide change")]
        : [gt("Show details"), gt("Hide details")];
  return (
    <div
      className="one-chat-approval"
      data-chat-approval=""
      data-open={open ? "" : undefined}
      data-leaving={leaving ? "" : undefined}
    >
      <div className="one-chat-approval-inner">
        <p className="one-chat-approval-sentence">
          <ApprovalSentence approval={approval} subject={subject} workspaceRoot={workspaceRoot} />
        </p>
        <div id={bodyId}>
          <TimelinePendingApprovalRow approval={approval} />
        </div>
        <div className="one-chat-approval-toggle">
          <InlineButton
            tone="muted"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? reveal[1] : reveal[0]}
          </InlineButton>
        </div>
      </div>
    </div>
  );
}
