import {
  FULL_ACCESS_OVERRIDE_QUESTION,
  fullAccessOverrideExplanation,
} from "@t3tools/client-runtime/state/thread-requests";
import { msg, T, useGT, useMessages } from "gt-react";
import { ShieldIcon } from "lucide-react";
import { useTurnItemDetail } from "../../state/queries";
import { type ApprovalHunkLine } from "./approvalHunk";
import { useApprovalPreview } from "./useApprovalPreview";
import { memo, use } from "react";
import { type PendingApproval } from "../../session-logic";
import { Badge } from "../ui/badge";
import { InlineButton } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  ApprovalSubjectContext,
  isGenericFileChangePrompt,
  relativeToWorkspace,
  splitPathForEllipsis,
  type ApprovalSubject,
} from "~/one/chatApprovalSubject";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { ToolActivityIconView, type WorkEntryIconName } from "./TimelineToolActivityIcon";
import { TimelineRowCtx } from "./timelineRowContext";

const APPROVAL_PRESENTATION = {
  command: {
    icon: "terminal",
    label: msg("Command approval"),
    title: msg("Run command"),
    detailLabel: msg("Command", { $context: "noun, shell command awaiting approval" }),
  },
  "file-change": {
    icon: "square-pen",
    label: msg("File change approval"),
    title: msg("Edit files"),
    detailLabel: msg("File change"),
  },
  "file-read": {
    icon: "eye",
    label: msg("File read approval"),
    title: msg("Read file"),
    detailLabel: msg("File to read"),
  },
  permission: {
    icon: "wrench",
    label: msg("App permission approval"),
    title: msg("App permission"),
    detailLabel: msg("Permission request"),
  },
  "mcp-elicitation": {
    icon: "hammer",
    label: msg("App access approval"),
    title: msg("App access"),
    detailLabel: msg("App access request"),
  },
} satisfies Record<
  PendingApproval["requestKind"],
  { icon: WorkEntryIconName; label: string; title: string; detailLabel: string }
>;

/** The file a change asks to touch: its name always shows, its directory gives way to an ellipsis. */
function ApprovalSubjectTitle({
  subject,
  workspaceRoot,
  label,
}: {
  readonly subject: ApprovalSubject;
  readonly workspaceRoot: string | undefined;
  readonly label: string;
}) {
  const gt = useGT();
  const { directory, name } = splitPathForEllipsis(
    relativeToWorkspace(subject.path, workspaceRoot),
  );
  const counts =
    subject.additions !== null && subject.deletions !== null
      ? gt("+{additions} −{deletions}", {
          additions: subject.additions,
          deletions: subject.deletions,
        })
      : null;
  const more =
    subject.moreFiles > 0
      ? gt("{count, plural, one {and {count} more file} other {and {count} more files}}", {
          count: subject.moreFiles,
        })
      : null;
  return (
    <>
      <span data-approval-verb="">
        <T>Edit</T>
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <code
              aria-label={label}
              data-approval-path=""
              data-approval-detail="complete"
              tabIndex={0}
            />
          }
        >
          {directory ? <span data-approval-path-directory="">{directory}</span> : null}
          <span data-approval-path-name="">{name}</span>
        </TooltipTrigger>
        <TooltipPopup side="top">{subject.path}</TooltipPopup>
      </Tooltip>
      {counts ? <span data-approval-meta="">{counts}</span> : null}
      {more ? <span data-approval-meta="">{more}</span> : null}
    </>
  );
}

/** What a preview row is, for a reader who cannot see the sign and the tint. */
function useRowLabel() {
  const gt = useGT();
  return (line: ApprovalHunkLine) => {
    const number = line.number;
    switch (line.kind) {
      case "add":
        return number === null ? gt("Added line") : gt("Added line {number}", { number });
      case "delete":
        return number === null ? gt("Removed line") : gt("Removed line {number}", { number });
      case "context":
        return number === null ? gt("Unchanged line") : gt("Unchanged line {number}", { number });
      case "plain":
        return gt("Recorded line");
    }
  };
}

/**
 * The first lines of the exact change being approved. The preview is computed after the card
 * paints, so Approve and Decline never wait for it, and "Show full diff" is offered whether or not
 * there is a preview to show.
 */
function ApprovalHunk({
  subject,
  onShowFullDiff,
}: {
  readonly subject: ApprovalSubject;
  readonly onShowFullDiff: (() => void) | null;
}) {
  const gt = useGT();
  const rowLabel = useRowLabel();
  const { activeThreadEnvironmentId, turnItemSource } = use(TimelineRowCtx);
  // The wire item keeps no patch to stay small, so the exact matched item is fetched, as the
  // diff panel does for "Show full diff".
  const needsFetch = subject.diffStr === null && subject.diffTarget !== null;
  const detail = useTurnItemDetail(
    needsFetch && subject.diffTarget
      ? { environmentId: activeThreadEnvironmentId, ...subject.diffTarget }
      : null,
    turnItemSource?.detail,
  );
  const fetched = detail.data?.item?.type === "file_change" ? detail.data.item : null;
  const diffStr = subject.diffStr ?? fetched?.diffStr;
  const hasContent = Boolean(diffStr?.trim()) || fetched?.oldStr != null || fetched?.newStr != null;
  const { ready, preview } = useApprovalPreview(
    hasContent
      ? {
          diffStr,
          oldStr: fetched?.oldStr,
          newStr: fetched?.newStr,
          operation: fetched?.changes?.[0]?.operation,
        }
      : null,
  );
  const loading = !hasContent ? needsFetch && detail.isPending && detail.error === null : !ready;
  const failed = !hasContent && needsFetch && detail.error !== null;
  if (preview === null && !loading && !failed && onShowFullDiff === null) return null;
  const remaining =
    preview !== null && preview.hidden !== null && preview.hidden > 0
      ? gt("{count, plural, one {{count} more line} other {{count} more lines}}", {
          count: preview.hidden,
        })
      : null;
  return (
    <div data-approval-content="hunk" data-approval-hunk="">
      {preview !== null ? (
        <div role="group" aria-label={gt("Change preview")} data-approval-hunk-lines="">
          {preview.lines.map((line, index) => (
            // A preview is a fixed, short list that never reorders.
            // oxlint-disable-next-line react/no-array-index-key
            <div key={index} data-kind={line.kind}>
              <span aria-hidden data-approval-hunk-number="">
                {line.number}
              </span>
              <span aria-hidden data-approval-hunk-sign="">
                {line.kind === "add" ? "+" : line.kind === "delete" ? "−" : ""}
              </span>
              <code>
                <span className="sr-only">{rowLabel(line)}: </span>
                <span>{line.text || " "}</span>
              </code>
            </div>
          ))}
        </div>
      ) : loading ? (
        <div role="status" data-approval-preview-state="">
          <T>Loading preview…</T>
        </div>
      ) : failed ? (
        <div data-approval-preview-state="">
          <span>
            <T>Couldn't load the preview.</T>
          </span>
          <InlineButton tone="muted" onClick={() => detail.refresh()}>
            <T>Retry</T>
          </InlineButton>
        </div>
      ) : null}
      {onShowFullDiff ? (
        <InlineButton tone="muted" data-approval-full-diff="" onClick={onShowFullDiff}>
          <T>Show full diff</T>
          {remaining ? <span>{` · ${remaining}`}</span> : null}
        </InlineButton>
      ) : remaining ? (
        <span data-approval-full-diff="">{remaining}</span>
      ) : null}
    </div>
  );
}

export const TimelinePendingApprovalRow = memo(function TimelinePendingApprovalRow({
  approval,
}: {
  approval: PendingApproval;
}) {
  const {
    respondingRequestIds,
    canOperateThread,
    onRespondToApproval,
    workspaceRoot,
    onOpenToolDiff,
  } = use(TimelineRowCtx);
  const subject = use(ApprovalSubjectContext).get(approval.requestId);
  const m = useMessages();
  const presentation = APPROVAL_PRESENTATION[approval.requestKind];
  const canRespond = approval.responseCapability === "live";
  return (
    <div
      role="group"
      aria-label={m(presentation.label)}
      data-v2-item-type="approval_request"
      data-approval-card=""
      className="m-raised"
    >
      <header data-approval-header="">
        <ToolActivityIconView
          icon={undefined}
          fallbackName={presentation.icon}
          className="block size-4 shrink-0 stroke-2 text-icon-muted"
          muted
        />
        <div data-approval-title="">
          {subject ? (
            <ApprovalSubjectTitle
              subject={subject}
              workspaceRoot={workspaceRoot}
              label={m(presentation.detailLabel)}
            />
          ) : (
            m(presentation.title)
          )}
        </div>
      </header>
      {approval.appName ||
      (subject && !isGenericFileChangePrompt(approval.detail)) ||
      approval.reason ? (
        <div data-approval-notes="">
          {approval.appName ? <span>{approval.appName}</span> : null}
          {subject && !isGenericFileChangePrompt(approval.detail) ? (
            <span>{approval.detail}</span>
          ) : null}
          {approval.reason ? <span>{approval.reason}</span> : null}
        </div>
      ) : null}
      {subject ? (
        <ApprovalHunk
          subject={subject}
          onShowFullDiff={
            onOpenToolDiff && subject.diffTarget ? () => onOpenToolDiff(subject.diffTarget!) : null
          }
        />
      ) : (
        <code
          aria-label={m(presentation.detailLabel)}
          data-approval-content="command"
          data-approval-detail="complete"
          tabIndex={0}
        >
          {approval.detail || m(presentation.label)}
        </code>
      )}
      <footer data-approval-footer="">
        <div data-approval-status="">
          {canRespond ? (
            <Badge variant="warning">
              <ShieldIcon aria-hidden />
              <T>Needs approval</T>
            </Badge>
          ) : (
            <span data-approval-stale="">
              <T>Provider process is gone. Interrupt or restart the run to respond.</T>
            </span>
          )}
          {approval.fullAccessOverride ? (
            <Popover>
              <PopoverTrigger openOnHover render={<InlineButton tone="muted" />}>
                {m(FULL_ACCESS_OVERRIDE_QUESTION)}
              </PopoverTrigger>
              <PopoverPopup
                aria-label={m(FULL_ACCESS_OVERRIDE_QUESTION)}
                tooltipStyle
                side="top"
                className="max-w-[min(22rem,calc(100vw-2rem))] whitespace-normal"
              >
                {fullAccessOverrideExplanation(approval.fullAccessOverride, m)}
              </PopoverPopup>
            </Popover>
          ) : null}
        </div>
        {canRespond && onRespondToApproval ? (
          <div data-approval-actions="">
            <ComposerPendingApprovalActions
              presentation="card"
              requestId={approval.requestId}
              disabled={!canOperateThread}
              isResponding={respondingRequestIds.includes(approval.requestId)}
              canRespond={canRespond}
              options={approval.options}
              onRespondToApproval={onRespondToApproval}
            />
          </div>
        ) : null}
      </footer>
    </div>
  );
});
