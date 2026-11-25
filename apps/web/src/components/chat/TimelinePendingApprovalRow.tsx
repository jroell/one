import {
  FULL_ACCESS_OVERRIDE_QUESTION,
  fullAccessOverrideExplanation,
} from "@t3tools/client-runtime/state/thread-requests";
import { msg, T, useGT, useMessages } from "gt-react";
import { ShieldIcon } from "lucide-react";
import { memo, use } from "react";
import { type PendingApproval } from "../../session-logic";
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
import { WorkLogRow } from "./WorkLog";

const APPROVAL_PRESENTATION = {
  command: {
    icon: "terminal",
    label: msg("Command approval"),
    detailLabel: msg("Command", { $context: "noun, shell command awaiting approval" }),
  },
  "file-change": {
    icon: "square-pen",
    label: msg("File change approval"),
    detailLabel: msg("File change"),
  },
  "file-read": { icon: "eye", label: msg("File read approval"), detailLabel: msg("File to read") },
  permission: {
    icon: "wrench",
    label: msg("App permission approval"),
    detailLabel: msg("Permission request"),
  },
  "mcp-elicitation": {
    icon: "hammer",
    label: msg("App access approval"),
    detailLabel: msg("App access request"),
  },
} satisfies Record<
  PendingApproval["requestKind"],
  { icon: WorkEntryIconName; label: string; detailLabel: string }
>;

/** The file a change asks to touch: its name always shows, its directory gives way to an ellipsis. */
function ApprovalSubjectLine({
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
    <div className="flex min-w-0 items-baseline gap-2" data-approval-subject>
      <Tooltip>
        <TooltipTrigger
          render={
            <code
              aria-label={label}
              className="flex min-w-0 font-mono text-xs leading-5 text-foreground select-text!"
              data-approval-detail="complete"
              tabIndex={0}
            />
          }
        >
          {directory ? <span className="min-w-0 truncate">{directory}</span> : null}
          <span className="shrink-0">{name}</span>
        </TooltipTrigger>
        <TooltipPopup side="top">{subject.path}</TooltipPopup>
      </Tooltip>
      {counts ? (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{counts}</span>
      ) : null}
      {more ? <span className="shrink-0 text-xs text-muted-foreground">{more}</span> : null}
    </div>
  );
}

export const TimelinePendingApprovalRow = memo(function TimelinePendingApprovalRow({
  approval,
}: {
  approval: PendingApproval;
}) {
  const { respondingRequestIds, canOperateThread, onRespondToApproval, workspaceRoot } =
    use(TimelineRowCtx);
  const subject = use(ApprovalSubjectContext).get(approval.requestId);
  const m = useMessages();
  const presentation = APPROVAL_PRESENTATION[approval.requestKind];
  const canRespond = approval.responseCapability === "live";
  return (
    <WorkLogRow
      role="group"
      aria-label={m(presentation.label)}
      data-v2-item-type="approval_request"
      wrapLabel
      icon={
        <ToolActivityIconView
          icon={undefined}
          fallbackName={presentation.icon}
          className="block size-4 shrink-0 stroke-2 text-icon-muted"
          muted
        />
      }
      label={
        subject ? (
          <ApprovalSubjectLine
            subject={subject}
            workspaceRoot={workspaceRoot}
            label={m(presentation.detailLabel)}
          />
        ) : (
          <code
            aria-label={m(presentation.detailLabel)}
            className="block max-h-40 min-w-0 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 text-foreground select-text! wrap-anywhere [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
            data-approval-detail="complete"
            tabIndex={0}
          >
            {approval.detail || m(presentation.label)}
          </code>
        )
      }
    >
      <div className="ms-7.5 flex min-w-0 flex-col gap-1 pb-1 text-xs">
        {approval.appName ? (
          <span className="text-muted-foreground wrap-anywhere">{approval.appName}</span>
        ) : null}
        {subject && !isGenericFileChangePrompt(approval.detail) ? (
          <span className="text-muted-foreground select-text wrap-anywhere">{approval.detail}</span>
        ) : null}
        {approval.reason ? (
          <span className="text-muted-foreground select-text wrap-anywhere">{approval.reason}</span>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {canRespond ? (
            <>
              <span className="inline-flex items-center gap-1 text-warning">
                <ShieldIcon aria-hidden className="size-3 shrink-0" />
                <T>Waiting for approval</T>
              </span>
              {onRespondToApproval ? (
                <ComposerPendingApprovalActions
                  presentation="inline"
                  requestId={approval.requestId}
                  disabled={!canOperateThread}
                  isResponding={respondingRequestIds.includes(approval.requestId)}
                  canRespond={canRespond}
                  options={approval.options}
                  onRespondToApproval={onRespondToApproval}
                />
              ) : null}
            </>
          ) : (
            <span className="text-warning">
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
      </div>
    </WorkLogRow>
  );
});
