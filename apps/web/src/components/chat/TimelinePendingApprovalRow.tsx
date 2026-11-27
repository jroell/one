import {
  FULL_ACCESS_OVERRIDE_QUESTION,
  fullAccessOverrideExplanation,
  PUSH_HOOKS_APPROVAL_LABEL,
  PUSH_HOOKS_APPROVAL_QUESTION,
} from "@t3tools/client-runtime/state/thread-requests";
import { chordApprovalRequestId } from "./approvalChord";
import { msg, T, useGT, useMessages } from "gt-react";
import { CheckIcon, ShieldIcon, XIcon } from "lucide-react";
import { shortcutLabelForCommand } from "../../keybindings";
import { useTurnItemDetail } from "../../state/queries";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { APPROVAL_FILES_SHOWN, approvalHeaderVerb, approvalVerb } from "./approvalChanges";
import { type ApprovalHunkLine } from "./approvalHunk";
import { useApprovalPreview } from "./useApprovalPreview";
import { useAtomValue } from "@effect/atom-react";
import { memo, use, useEffect, useRef, useState } from "react";
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
  type ApprovalSubjectChange,
} from "~/one/chatApprovalSubject";
import { ApprovalText } from "./ApprovalText";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { PushHooksApprovalDetails } from "./PushHooksApprovalDetails";
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

function PathLabel({ path, workspaceRoot }: { path: string; workspaceRoot: string | undefined }) {
  const { directory, name } = splitPathForEllipsis(relativeToWorkspace(path, workspaceRoot));
  return (
    <>
      {directory ? <span data-approval-path-directory="">{directory}</span> : null}
      <span data-approval-path-name="">{name}</span>
    </>
  );
}

/** The title says what the approval really is, and names the file when there is only one. */
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
  const files = subject.changes.length;
  const verb = approvalHeaderVerb(subject.changes);
  const counts =
    subject.additions !== null && subject.deletions !== null
      ? gt("+{additions} −{deletions}", {
          additions: subject.additions,
          deletions: subject.deletions,
        })
      : null;
  if (files > 1) {
    const text =
      verb === "add"
        ? gt("Add {count} files", { count: files })
        : verb === "delete"
          ? gt("Delete {count} files", { count: files })
          : verb === "rename"
            ? gt("Rename {count} files", { count: files })
            : verb === "edit"
              ? gt("Edit {count} files", { count: files })
              : gt("Change {count} files", { count: files });
    return (
      <>
        <span data-approval-verb="">{text}</span>
        {counts ? <span data-approval-meta="">{counts}</span> : null}
      </>
    );
  }
  const only = subject.changes[0];
  const target = only?.path ?? subject.path;
  const singleVerb = only === undefined ? "edit" : approvalVerb(only);
  return (
    <>
      <span data-approval-verb="">
        {singleVerb === "add"
          ? gt("Add")
          : singleVerb === "delete"
            ? gt("Delete")
            : singleVerb === "rename"
              ? gt("Rename")
              : gt("Edit")}
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
          {singleVerb === "rename" && only?.oldPath ? (
            <>
              <PathLabel path={only.oldPath} workspaceRoot={workspaceRoot} />
              <span aria-hidden> → </span>
            </>
          ) : null}
          <PathLabel path={target} workspaceRoot={workspaceRoot} />
        </TooltipTrigger>
        <TooltipPopup side="top">{target}</TooltipPopup>
      </Tooltip>
      {counts ? <span data-approval-meta="">{counts}</span> : null}
    </>
  );
}

/**
 * Every file the approval touches, with what happens to it, so nothing the work log row showed
 * is lost when the card stands in for that row. Five show; the rest fold behind a count.
 */
function ApprovalFileList({
  changes,
  workspaceRoot,
}: {
  readonly changes: ReadonlyArray<ApprovalSubjectChange>;
  readonly workspaceRoot: string | undefined;
}) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? changes : changes.slice(0, APPROVAL_FILES_SHOWN);
  const folded = changes.length - visible.length;
  const verbLabel = (change: ApprovalSubjectChange) => {
    switch (approvalVerb(change)) {
      case "add":
        return gt("Add");
      case "delete":
        return gt("Delete");
      case "rename":
        return gt("Rename");
      case "edit":
        return gt("Edit");
    }
  };
  return (
    <div data-approval-files="">
      <ul aria-label={gt("Files in this change")}>
        {visible.map((change) => (
          <li key={JSON.stringify([change.operation, change.oldPath, change.path])}>
            <span data-approval-file-verb="">{verbLabel(change)}</span>
            <code data-approval-file-path="">
              {change.oldPath && change.oldPath !== change.path ? (
                <>
                  <PathLabel path={change.oldPath} workspaceRoot={workspaceRoot} />
                  <span aria-hidden> → </span>
                </>
              ) : null}
              <PathLabel path={change.path} workspaceRoot={workspaceRoot} />
            </code>
            {change.fileType || change.mimeType ? (
              <span data-approval-meta="">
                {[change.fileType, change.mimeType].filter(Boolean).join(", ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {changes.length > APPROVAL_FILES_SHOWN ? (
        <InlineButton tone="muted" onClick={() => setExpanded((open) => !open)}>
          {expanded
            ? gt("Show fewer files")
            : gt("{count, plural, one {{count} more file} other {{count} more files}}", {
                count: folded,
              })}
        </InlineButton>
      ) : null}
    </div>
  );
}

/** What this client decided, or "answered" when it did not (another device, the provider). */
function approvalOutcome(
  decision: string | null | undefined,
): "approved" | "declined" | "cancelled" | "answered" {
  if (decision === "accept" || decision === "acceptForSession" || decision === "acceptAlways") {
    return "approved";
  }
  if (decision === "decline") return "declined";
  if (decision === "cancel") return "cancelled";
  return "answered";
}

/** A single file whose type or mime type only the list shows. */
function hasExtraDetail(change: ApprovalSubjectChange): boolean {
  return Boolean(change.fileType || change.mimeType);
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
      case "label":
        return "";
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
  const excerptLabel = (key: string) =>
    key === "before" ? gt("Before") : key === "after" ? gt("After") : gt("Recorded content");
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
          operation:
            (fetched?.changes ?? subject.changes).find((change) => change.path === subject.path)
              ?.operation ?? fetched?.changes?.[0]?.operation,
          path: subject.path,
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
          {preview.lines.map((line, index) =>
            line.kind === "label" ? (
              // A preview is a fixed, short list that never reorders.
              // oxlint-disable-next-line react/no-array-index-key
              <div key={index} data-kind="label">
                <span data-approval-hunk-label="">{excerptLabel(line.text)}</span>
              </div>
            ) : (
              // oxlint-disable-next-line react/no-array-index-key -- a fixed, short list that never reorders
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
                  {line.noNewline ? (
                    <span data-approval-no-newline="">
                      <T>No newline at end of file</T>
                    </span>
                  ) : null}
                </code>
              </div>
            ),
          )}
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
    pendingApprovals,
    leavingApprovals,
    onApprovalLeft,
    approvalChordHints,
  } = use(TimelineRowCtx);
  const cardRef = useRef<HTMLDivElement>(null);
  const leavingDecision = leavingApprovals?.get(approval.requestId);
  const outcome = approvalOutcome(leavingDecision);
  const leaving = leavingApprovals?.has(approval.requestId) === true;
  const subject = use(ApprovalSubjectContext).get(approval.requestId);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  // The chords answer the oldest waiting request that is not leaving, and only in the chat view's
  // own timeline, so only that card shows them, and only while they can answer it.
  const actedOn =
    approvalChordHints === true &&
    chordApprovalRequestId(pendingApprovals?.keys() ?? [], leavingApprovals) === approval.requestId;
  const shortcuts =
    actedOn && canOperateThread && approval.responseCapability === "live"
      ? {
          accept: shortcutLabelForCommand(keybindings, "approval.approve"),
          decline: shortcutLabelForCommand(keybindings, "approval.decline"),
        }
      : undefined;
  const m = useMessages();
  const gt = useGT();
  // The card leaves over its own animations: when they end, or at once when there are none (reduced
  // motion), the timeline drops it and the resolved row stands in.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the timeline the card's exit animation has finished
  useEffect(() => {
    if (!leaving) return;
    const animations = cardRef.current?.parentElement?.getAnimations({ subtree: true }) ?? [];
    if (animations.length === 0) {
      onApprovalLeft?.(approval.requestId);
      return;
    }
    let live = true;
    void Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(
      () => {
        if (live) onApprovalLeft?.(approval.requestId);
      },
    );
    return () => {
      live = false;
    };
  }, [leaving, approval.requestId, onApprovalLeft]);
  const presentation = APPROVAL_PRESENTATION[approval.requestKind];
  // T3 Code's own question reads as the app asking: a plain sentence, then what it names.
  const { pushHooks } = approval;
  const label = pushHooks ? PUSH_HOOKS_APPROVAL_LABEL : presentation.label;
  const canRespond = approval.responseCapability === "live";
  return (
    <div data-approval-host="" data-leaving={leaving ? "" : undefined}>
      <div
        ref={cardRef}
        role="group"
        aria-label={m(label)}
        data-approval-card=""
        data-approval-request-id={approval.requestId}
        data-leaving={leaving ? "" : undefined}
        data-outcome={leaving ? approvalOutcome(leavingDecision) : undefined}
        data-responding={
          leaving || respondingRequestIds.includes(approval.requestId) ? "" : undefined
        }
        className="m-thick"
      >
        <header data-approval-header="">
          <ToolActivityIconView
            icon={undefined}
            fallbackName={pushHooks ? "terminal" : presentation.icon}
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
            ) : pushHooks ? (
              m(PUSH_HOOKS_APPROVAL_QUESTION)
            ) : (
              m(presentation.title)
            )}
          </div>
        </header>
        <div data-approval-body="">
          <div data-approval-body-inner="">
            {subject && (subject.changes.length > 1 || subject.changes.some(hasExtraDetail)) ? (
              <ApprovalFileList changes={subject.changes} workspaceRoot={workspaceRoot} />
            ) : null}
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
            {pushHooks ? (
              <div data-approval-content="text" className="px-4 py-2.5">
                <PushHooksApprovalDetails pushHooks={pushHooks} />
              </div>
            ) : null}
            {subject ? (
              <ApprovalHunk
                subject={subject}
                onShowFullDiff={
                  onOpenToolDiff && subject.diffTarget
                    ? () => onOpenToolDiff(subject.diffTarget!)
                    : null
                }
              />
            ) : pushHooks ? null : (
              <div data-approval-content="text" className="[&>span]:px-4 [&>span]:pb-2">
                <ApprovalText
                  text={approval.detail || m(presentation.label)}
                  label={m(presentation.detailLabel)}
                  className="px-4 py-2.5"
                />
              </div>
            )}
          </div>
        </div>
        <footer data-approval-footer="">
          <div data-approval-status="">
            {leaving ? (
              <span data-approval-outcome="">
                {outcome === "approved" ? <CheckIcon aria-hidden /> : null}
                {outcome === "declined" || outcome === "cancelled" ? <XIcon aria-hidden /> : null}
                {outcome === "approved"
                  ? gt("Approved")
                  : outcome === "declined"
                    ? gt("Declined")
                    : outcome === "cancelled"
                      ? gt("Cancelled")
                      : gt("Answered")}
              </span>
            ) : canRespond ? (
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
                shortcuts={shortcuts}
                disabled={!canOperateThread}
                isResponding={leaving || respondingRequestIds.includes(approval.requestId)}
                canRespond={canRespond}
                options={approval.options}
                onRespondToApproval={onRespondToApproval}
              />
            </div>
          ) : null}
        </footer>
      </div>
    </div>
  );
});
