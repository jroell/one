import { T, useGT, useMessages, Var } from "gt-react";
import type { SideThreadOpenIntent } from "@t3tools/client-runtime/side-thread";
import type { ThreadRunSummary } from "@t3tools/client-runtime/state/models";
import { threadErrorText } from "@t3tools/client-runtime/state/threads";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import type { ToolCallDiffTarget } from "../../diffPanelStore";
import { AudioPreviewUnmountContext } from "../files/AudioPreview";
import { ThreadFindTimelineContext } from "./ThreadFindProvider";
import { MarkdownFindContext } from "./markdownFindContext";
import { useChatCanvas } from "./ChatCanvasContext";
import type { ProviderApprovalDecision, RuntimeRequestId } from "@t3tools/contracts";
import { WorkLogBlock } from "./WorkLog";
import {
  clearApprovalDecision,
  peekApprovalDecision,
  pruneApprovalDecisions,
} from "~/one/approvalDecision";
import { TimelinePendingApprovalRow } from "./TimelinePendingApprovalRow";
import type { WorktreeSetupSnapshot } from "@t3tools/contracts";
import { deriveTimelineMinimapItems } from "./timelineMinimapItems";
import {
  type AssistantCitation,
  type EnvironmentId,
  type MessageId,
  type OrchestrationV2TurnItem,
  type RunAttemptId,
  type ServerProviderSkill,
  type RunId,
  ThreadId,
} from "@t3tools/contracts";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { resolveWorkGroupScrollAnchor } from "@t3tools/client-runtime/work-log/scroll-anchor";
import type { WorkflowOpening } from "@t3tools/client-runtime/state/subagentRuntime";
import { observeResize } from "~/lib/observeResize";
import { preserveReadingPosition } from "~/lib/preserveReadingPosition";
import { useStableCallback } from "~/hooks/useStableCallback";

const NOOP_USE_ARTIFACT_TEMPLATE = () => {};
const EMPTY_APPROVAL_MAP = new Map<never, never>();
const EMPTY_PENDING_APPROVALS: ReadonlyArray<PendingApproval> = [];
const EMPTY_RESPONDING_REQUEST_IDS: TimelineRowSharedState["respondingRequestIds"] = [];

const NOOP_OPEN_ATTACHMENT = (_attachment: ChatFileAttachment) => {};

import { resolveChatListAnchoredEndSpace } from "@t3tools/shared/chatList";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";
import {
  memo,
  use,
  useContext,
  useLayoutEffect,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import {
  LegendList,
  type LegendListRef,
  type MaintainScrollAtEndOptions,
} from "@legendapp/list/react";
import { type PendingApproval, type TimelineEntry } from "../../session-logic";
import type { CodexArtifactTemplate } from "@t3tools/shared/codexArtifactTemplates";
import { type ChatFileAttachment, type TurnDiffSummary } from "../../types";
import {
  ArrowRightIcon,
  BotIcon,
  CircleAlertIcon,
  MessagesSquareIcon,
  Minimize2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";
import { Skeleton } from "../ui/skeleton";
import { ExpandedImagePreview } from "./ExpandedImagePreview";
import {
  CHAT_TIMELINE_ANCHOR_OFFSET,
  readTimelinePosition,
  type RememberedTimelinePosition,
  rememberTimelinePosition,
  resolveDisclosureRevealScrollDelta,
} from "./timelineScrollAnchoring";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { type AssistantCitationRequest } from "./AssistantCitationSource";
import { useAssistantCitationTarget } from "./useAssistantCitationTarget";
import { worktreeSetupAgentStarted } from "@t3tools/client-runtime/worktree-setup";
import { resolveCitationPhase, type CitedHistory } from "./citationProcedure";
import {
  resolveTimelineIsAtEnd,
  resolveTimelineMinimapHasPersistentGutter,
  resolveTimelineMinimapCurrentIndex,
  isTimelineMinimapTurnVisible,
  resolveTimelineMinimapVisibleRange,
  resolveTimelineMinimapHitStrip,
  TIMELINE_MINIMAP_TARGET_OFFSET,
  timelineTurnFoldRunIdsByEntryId,
  liveAnswerPreview,
  type MessagesTimelineRow,
  type TimelineLatestRun,
} from "./MessagesTimeline.logic";
import { type ThreadFindMatch } from "./threadFind";
import { useThreadFindNavigation } from "./useThreadFindNavigation";
import { TooltipScrollDismissArea } from "../ui/tooltip";
import { WorktreeSetupCard } from "./WorktreeSetupCard";
import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { OneEmptyState } from "~/one/OneEmptyState";
import { useWorkspaceMode } from "~/one/workspaceMode";
import { quietedLiveWorkIds } from "~/one/chatQuietWork";
import { ChatArrivalContext, useChatArrival, useChatArrivalProps } from "~/one/chatArrival";
import { ChatQuizMessageContext } from "~/one/chatQuiz";
import { ChatStageBlock } from "~/one/ChatWaitingStage";
import {
  ChatEndHoldContext,
  ChatHandoffAnswerContext,
  ChatStageContext,
  ChatStageLayerContext,
  findChatStageTarget,
  findHandoffAnswerId,
  useChatStage,
} from "~/one/chatStage";
import { ApprovalSubjectContext, deriveApprovalSubjects } from "~/one/chatApprovalSubject";
import type { ComposerHandleRef } from "~/composerHandleContext";
import { ChatFollowUps } from "~/one/ChatFollowUps";
import { useVoiceStageOpen } from "~/one/voiceSession";
import {
  ChatFollowUpContext,
  resolveChatFollowUpTarget,
  NO_FOLLOW_UP,
} from "~/one/chatFollowUpTarget";
import { ChatNav } from "~/one/ChatNav";
import { deriveChatSections, NO_CHAT_SECTIONS, type ChatSection } from "~/one/chatSections";
import { chatFoldLabel } from "~/one/chatFoldLabel";
import { ChatNoticeLine } from "~/one/ChatNoticeLine";
import { ChatStatusScopeContext, publishChatStatus, type ChatStatusItem } from "~/one/chatStatus";
import {
  ChatNoticePlanContext,
  isNoticeEntry,
  noticeDetail,
  NO_CHAT_NOTICES,
  planChatNotices,
  quietNotices,
} from "~/one/chatNotices";
import { ChatWaitingLine } from "~/one/ChatWaitingLine";
import { resolveOutlineCurrentIndex } from "~/one/chatOutlineLayout";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { type HandoffTimelineRun } from "./V2LifecycleRow";
import { TimelineSystemDivider } from "./TimelineSystemDivider";

import { forwardWheelToTimeline } from "./timelineMinimapWheel";
import { isFirstScreenReady, setFirstScreenReady } from "./firstScreenReady";
import { TimelineMinimap } from "./TimelineMinimap";
import {
  type TimelineRowSharedState,
  type TimelineRowActivityState,
  TimelineRowCtx,
  TimelineRowActivityCtx,
  type WorkGroupViewState,
  type TimelineRow,
} from "./timelineRowContext";
import { TimelineRowTimestamp, ActivityShimmerOverlay } from "./TimelineRowParts";
import {
  WorkGroupSection,
  WorkingTimelineRow,
  ThinkingTimelineRow,
  LiveWorkEntryTimelineRow,
  WorkGroupToggleTimelineRow,
} from "./TimelineWorkGroupRows";
import { ViewedImagesTimelineRow } from "./TimelineWorkEntryRow";
import { UserMessageRow } from "./TimelineUserMessageRow";
import {
  AssistantTimelineRow,
  AssistantMetaTimelineRow,
  ProposedPlanTimelineRow,
  HtmlRenderTimelineRow,
  SentMessageTimelineRow,
  McpAppTimelineRow,
} from "./TimelineAssistantRows";
import { V2EventTimelineRow } from "./TimelineV2EventRow";
import { startTimelinePositionRestore } from "./useTimelinePositionRestore";
import {
  attachTimelineViewport,
  nextListOpening,
  type TimelineListOpening,
  type TimelineViewport,
} from "./timelineViewport";
import { useThreadFindPositionReader } from "./useThreadFindPositionReader";
import { ThreadActivityAnnouncer } from "./ThreadActivityAnnouncer";
import { useStableHandoffRuns, useIncrementalTimelineRows, useStableRows } from "./useTimelineRows";
import { useClientSettings } from "../../hooks/useSettings";

function timelineListStateFor(identity: string): {
  readonly identity: string;
  readonly rememberedPosition: RememberedTimelinePosition | undefined;
  readonly workGroupViewState: WorkGroupViewState;
} {
  const rememberedPosition = readTimelinePosition(identity);
  return {
    identity,
    rememberedPosition,
    workGroupViewState: rememberedPosition?.disclosures?.workGroupState ?? {
      scrollPositions: new Map(),
      expandedEntries: new Set(),
    },
  };
}

/** Chat mode's room, below the composer's own inset, for the last line to rest above it. */
const CHAT_END_GAP_PX = 24;

const TIMELINE_LIST_HEADER = <div className="h-3 sm:h-4" />;
const TIMELINE_LIST_FADE_HEADER = (
  <div className="h-[var(--workspace-titlebar-scroll-fade-height)]" />
);
// A floating preview over the lower half of a narrow chat covers the timeline's last rows,
// so the end must scroll them above it as it does for the composer.
function resolveTimelineEndInset(composerInset: number, canvas: ReturnType<typeof useChatCanvas>) {
  const frame = canvas?.layout.overlapsChat ? canvas.layout.frame : null;
  const height = canvas?.container.height ?? 0;
  if (!frame || frame.y + frame.height / 2 < height / 2) return composerInset;
  return Math.max(composerInset, Math.ceil(height - frame.y));
}

function TimelineListFooter({
  composerInset,
  onGrow,
  children,
}: {
  readonly composerInset: number;
  readonly onGrow: (() => void) | undefined;
  readonly children?: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports growth of the footer's content, which the list does not follow
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !onGrow) return;
    let height = content.offsetHeight;
    return observeResize(content, () => {
      const next = content.offsetHeight;
      if (next > height) onGrow();
      height = next;
    });
  }, [onGrow]);
  return (
    <div>
      <div ref={contentRef}>{children}</div>
      <div aria-hidden style={{ height: composerInset }} />
      <div aria-hidden className="h-3 sm:h-4" />
    </div>
  );
}

const EMPTY_TIMELINE_SKILLS: ReadonlyArray<ServerProviderSkill> = [];
const TIMELINE_MAINTAIN_SCROLL_AT_END = {
  animated: false,
  on: {
    dataChange: true,
    footerLayout: false,
    itemLayout: true,
    layout: true,
  },
} as const satisfies MaintainScrollAtEndOptions;
const EMPTY_RUN_IDS: ReadonlySet<RunId> = new Set();
const EMPTY_TIMELINE_ENTRIES: ReadonlyArray<TimelineEntry> = [];
const TIMELINE_MAINTAIN_SCROLL_AT_END_SMOOTH = {
  ...TIMELINE_MAINTAIN_SCROLL_AT_END,
  animated: true,
} as const satisfies MaintainScrollAtEndOptions;

const CITED_HISTORY_LOADING: CitedHistory = { _tag: "loading" };

export interface MessagesTimelineHistoryControls {
  readonly hasMoreHistory: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onLoadEarlier: (throughEntryId?: string) => void;
}

/** Longer than a card's whole exit (press, fold, settle), so only a card that never reports hits it. */
const APPROVAL_LEAVE_FALLBACK_MS = 1200;

interface MessagesTimelineProps {
  pendingApprovals?: ReadonlyArray<PendingApproval>;
  heldApprovalRequestIds?: ReadonlySet<string> | undefined;
  /** Show the Approve and Decline chords on the card they answer. Only the chat view's own timeline does. */
  showApprovalChordHints?: boolean;
  /** The thread's messages have not arrived yet, so an empty list is not an empty thread. */
  detailLoading?: boolean;
  respondingRequestIds?: TimelineRowSharedState["respondingRequestIds"];
  canOperateThread?: boolean;
  onRespondToApproval?: TimelineRowSharedState["onRespondToApproval"];
  citationRequest?: AssistantCitationRequest | null;
  citationHistory?: CitedHistory;
  onCiteAssistantText?: (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
  ) => boolean;
  onReplyToResponse?: TimelineRowSharedState["onReplyToResponse"];
  isWorking: boolean;
  /** The thread is catching up from a cached copy, whose working state may be stale. */
  syncing?: boolean;
  runlessWorkActive?: boolean;
  activeTurnStartedAt?: string | null;
  /** Replaces "Thinking" while the active run's provider has not started a turn. */
  providerStartingLabel?: string | null;
  providerStarting?: NonNullable<ThreadRunSummary["providerStarting"]> | null;
  worktreeSetup?: WorktreeSetupSnapshot | null;
  onCancelWorktreeSetup?: () => void;
  retryableWorkspacePreparationRunIds?: ReadonlySet<RunId>;
  onRetryWorkspacePreparation?: (runId: RunId) => void;
  onWorktreeSetupWorkLocally?: () => void;
  onOpenWorktreeSetupTerminal?: (terminalId: string) => void;
  isPreparingWorktree?: boolean;
  isCompacting?: boolean;
  awaitingUser?: "approval" | "input" | null;
  /** Which request is waiting, so a second one of the same kind is announced too. */
  awaitingRequestId?: string | null;
  footer?: ReactNode;

  listRef: React.RefObject<LegendListRef | null>;
  timelineEntries: ReadonlyArray<TimelineEntry>;
  latestRun: TimelineLatestRun | null;
  usageLimitRunId?: RunId | null;
  /** The run the screen reader announcer follows; see announcedRun. */
  announcedRun?: { readonly runId: RunId; readonly status: TimelineLatestRun["status"] } | null;
  /** See isDetailBehindShell. */
  detailBehindShell?: boolean;
  runningRunId?: RunId | null;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  routeThreadKey: string;
  displayThreadKey?: string;
  /** Off where another region already speaks the thread's status, like a subagent's bar. */
  announceTurnStatus?: boolean;
  onOpenToolDiff?: (target: ToolCallDiffTarget) => void;
  onOpenThread: (
    threadId: OrchestrationV2TurnItem["threadId"],
    environmentId?: EnvironmentId,
    /** How the click asked to open a subagent or side chat; a plain click when absent. */
    intent?: SideThreadOpenIntent,
  ) => void;
  renderHtmlRender?: TimelineRowSharedState["renderHtmlRender"];
  turnItemSource?: TimelineRowSharedState["turnItemSource"];
  /**
   * The thread this one is a subagent or side chat of; `open` is absent when it cannot be
   * opened from here.
   */
  parentThreadLink?: {
    readonly title: string;
    /** A side chat's inherited rows collapse into this link. */
    readonly sideChat?: boolean;
    /** Where it runs, when that is another environment. */
    readonly environmentLabel?: string;
    /** What this thread is to it, when not its subagent or side chat: `Step of`, say. */
    readonly relation?: { readonly label: string; readonly actionLabel: string };
    readonly open?: () => void;
  } | null;
  workflowOpening?: WorkflowOpening | null;
  onForkFromRun?: (input: {
    readonly sourceThreadId: ThreadId;
    readonly runId: RunId;
  }) => Promise<void>;
  supportsConversationRollback: boolean;
  threadStartCheckpointAvailable?: boolean;
  availableRevertTurnCounts?: ReadonlySet<number> | undefined;
  onRevertToTurnCount: (targetTurnCount: number, messageId: MessageId) => void;
  onUseArtifactTemplate?: (template: CodexArtifactTemplate) => void;
  onSendAppMessage?: (text: string) => Promise<void>;
  onRunShellCommand?: (command: string) => void;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onFileOpen?: (attachment: ChatFileAttachment) => void;
  onFileDownload?: (attachment: ChatFileAttachment) => void;
  activeThreadEnvironmentId: EnvironmentId;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  skills?: ReadonlyArray<ServerProviderSkill>;
  runs: ReadonlyArray<HandoffTimelineRun>;
  anchorMessageId: MessageId | null;
  onAnchorReady: (messageId: MessageId, anchorIndex: number) => void;
  onAnchorSizeChanged: (messageId: MessageId, size: number) => void;
  contentInsetEndAdjustment: number;
  onIsAtEndChange: (isAtEnd: boolean) => void;
  /** Disable while reading history to prevent LegendList re-pinning near the bottom. */
  liveFollowEnabled: boolean;
  /** Receives the list's viewport when it mounts; the returned cleanup runs when it goes away. */
  onViewportAttach?: (viewport: TimelineViewport) => () => void;
  /** The footer's content grew, such as a new queued turn or status line. */
  onFooterGrow?: () => void;
  findOpen?: boolean;
  hideEmptyPlaceholder?: boolean;
  /** Composer space to center the empty state against; held steady through collapse. */
  emptyPlaceholderInset: number;
  topFadeEnabled?: boolean;
  historyControls?: MessagesTimelineHistoryControls | undefined;
  /** The composer under this timeline; without one, Chat mode offers no follow-up actions. */
  composerRef?: ComposerHandleRef | null;
  findExpanded?: boolean;
  findQuery?: string;
  activeFindMatch?: ThreadFindMatch | null;
  findNavigationId?: number;
}

export function MessagesTimeline(props: MessagesTimelineProps) {
  const find = useContext(ThreadFindTimelineContext);
  const findOpen = find?.findOpen ?? props.findOpen;
  // Voice chat covers the whole window. The timeline under it keeps the props it had when voice
  // chat opened, so streamed tokens are not rendered into a view nobody sees, and it catches up
  // in one render when voice chat closes.
  const voiceOpen = useVoiceStageOpen();
  const [held, setHeld] = useState<MessagesTimelineProps | null>(null);
  if (voiceOpen && held === null) setHeld(props);
  if (!voiceOpen && held !== null) setHeld(null);
  const shown = held ?? props;
  return (
    <ConversationTimeline
      {...shown}
      {...find}
      liveFollowEnabled={!findOpen && shown.liveFollowEnabled}
    />
  );
}

const ConversationTimeline = memo(function ConversationTimeline({
  pendingApprovals = EMPTY_PENDING_APPROVALS,
  heldApprovalRequestIds,
  showApprovalChordHints = false,
  detailLoading = false,
  respondingRequestIds = EMPTY_RESPONDING_REQUEST_IDS,
  canOperateThread = false,
  onRespondToApproval,
  citationRequest = null,
  citationHistory = CITED_HISTORY_LOADING,
  onCiteAssistantText,
  onReplyToResponse,
  isWorking,
  syncing = false,
  runlessWorkActive = false,
  activeTurnStartedAt = null,
  providerStartingLabel = null,
  providerStarting = null,
  worktreeSetup = null,
  footer = null,
  onCancelWorktreeSetup,
  retryableWorkspacePreparationRunIds = EMPTY_RUN_IDS,
  onRetryWorkspacePreparation,
  onWorktreeSetupWorkLocally,
  onOpenWorktreeSetupTerminal,
  isPreparingWorktree = false,
  isCompacting = false,
  awaitingUser = null,
  awaitingRequestId = null,
  listRef,
  timelineEntries,
  findOpen = false,
  findExpanded = false,
  findQuery = "",
  activeFindMatch = null,
  findNavigationId = 0,
  latestRun,
  usageLimitRunId = null,
  announcedRun = null,
  detailBehindShell = false,
  runningRunId = null,
  turnDiffSummaries,
  routeThreadKey,
  displayThreadKey,
  announceTurnStatus = true,
  onOpenToolDiff,
  onOpenThread,
  renderHtmlRender,
  turnItemSource,
  parentThreadLink = null,
  workflowOpening = null,
  onForkFromRun,
  supportsConversationRollback,
  threadStartCheckpointAvailable = false,
  availableRevertTurnCounts,
  onRevertToTurnCount,
  onUseArtifactTemplate = NOOP_USE_ARTIFACT_TEMPLATE,
  onSendAppMessage,
  onRunShellCommand,
  isRevertingCheckpoint,
  onImageExpand,
  onFileOpen = NOOP_OPEN_ATTACHMENT,
  onFileDownload = NOOP_OPEN_ATTACHMENT,
  activeThreadEnvironmentId,
  markdownCwd,
  resolvedTheme,
  timestampFormat,
  workspaceRoot,
  skills = EMPTY_TIMELINE_SKILLS,
  runs: runsProp,
  anchorMessageId,
  onAnchorReady,
  onAnchorSizeChanged,
  contentInsetEndAdjustment: composerInsetEnd,
  onIsAtEndChange,
  liveFollowEnabled,
  onViewportAttach,
  onFooterGrow,
  hideEmptyPlaceholder = false,
  emptyPlaceholderInset,
  topFadeEnabled = false,
  historyControls,
  composerRef = null,
}: MessagesTimelineProps) {
  const gt = useGT();
  const canvas = useChatCanvas();
  const chatMode = useWorkspaceMode() === "chat";
  // Chat mode rests the last line a little further above the composer, clear of the pill's band.
  const contentInsetEndAdjustment =
    resolveTimelineEndInset(composerInsetEnd, canvas) + (chatMode ? CHAT_END_GAP_PX : 0);
  const listIdentityKey = displayThreadKey ?? routeThreadKey;
  // Snapshot restore positions on identity changes; ongoing scroll writes must not move them.
  // Find open at the opening is part of the snapshot: opening find later
  // announces its own navigation (threadFindStore's announceOpening).
  const [listState, setListState] = useState(() => ({
    ...timelineListStateFor(listIdentityKey),
    findOpenAtOpening: findOpen,
  }));
  const [expandedRunIds, setExpandedRunIds] = useState<ReadonlySet<RunId>>(
    () => listState.rememberedPosition?.disclosures?.runs ?? new Set(),
  );
  const [expandedWorkGroupIds, setExpandedWorkGroupIds] = useState<ReadonlySet<string>>(
    () => listState.rememberedPosition?.disclosures?.workGroups ?? new Set(),
  );
  const [expandedAttemptIds, setExpandedAttemptIds] = useState<ReadonlySet<RunAttemptId>>(
    () => listState.rememberedPosition?.disclosures?.attempts ?? new Set(),
  );
  // A list that opens on a thread with find open takes the opening step below,
  // so the restore runs and releases follow once for find.
  const [positionedThreadKey, setPositionedThreadKey] = useState<string | null>(() =>
    listState.rememberedPosition?.atEnd === false || findOpen ? null : listIdentityKey,
  );
  const restoringThreadPosition = positionedThreadKey !== listIdentityKey;
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [settlingListIdentity, setSettlingListIdentity] = useState<string | null>(listIdentityKey);
  const [playingAudioRows, setPlayingAudioRows] = useState<ReadonlyMap<HTMLAudioElement, string>>(
    () => new Map(),
  );
  const [fullscreenAppRowId, setFullscreenAppRowId] = useState<string | null>(null);
  let paintedExpandedRunIds = expandedRunIds;
  let paintedExpandedWorkGroupIds = expandedWorkGroupIds;
  let paintedExpandedAttemptIds = expandedAttemptIds;
  const identityChanged = listState.identity !== listIdentityKey;
  const { rememberedPosition, workGroupViewState } = identityChanged
    ? timelineListStateFor(listIdentityKey)
    : listState;
  if (identityChanged) {
    setPlayingAudioRows(new Map());
    setListState({
      identity: listIdentityKey,
      rememberedPosition,
      workGroupViewState,
      findOpenAtOpening: findOpen,
    });
    setPositionedThreadKey(null);
    setSettlingListIdentity(listIdentityKey);
    // A viewer pinned in another thread must not keep live follow off here,
    // nor when that thread comes back.
    setFullscreenAppRowId(null);
    paintedExpandedRunIds = rememberedPosition?.disclosures?.runs ?? new Set();
    paintedExpandedWorkGroupIds = rememberedPosition?.disclosures?.workGroups ?? new Set();
    paintedExpandedAttemptIds = rememberedPosition?.disclosures?.attempts ?? new Set();
    setExpandedRunIds(paintedExpandedRunIds);
    setExpandedWorkGroupIds(paintedExpandedWorkGroupIds);
    setExpandedAttemptIds(paintedExpandedAttemptIds);
  }
  const citationThreadRef = parseScopedThreadKey(routeThreadKey);
  const openPullRequest = useOpenPrLink(citationThreadRef ?? undefined);
  const [minimapStripMap] = useState(() => new Map<string, HTMLSpanElement>());
  const normalizedFindQuery = findQuery.trim();
  const findActive = findExpanded;

  const disclosureRevealRef = useRef<{
    key: string;
    identity: string;
    entryId: string | undefined;
    contentKey: string | undefined;
    ready: boolean;
  } | null>(null);
  const disclosureRevealFrameRef = useRef<number | null>(null);

  // Anchoring keeps the toggled row still, so content that expands below it
  // near the bottom would otherwise land under the composer.
  const revealExpandedDisclosure = useStableCallback(() => {
    const pending = disclosureRevealRef.current;
    if (!pending || pending.identity !== listIdentityKey) return;
    const state = listRef.current?.getState();
    const element = listRef.current?.getScrollableNode();
    const index = state?.indexByKey(pending.key);
    const row = index === undefined ? undefined : state?.elementAtIndex(index);
    if (!element || !(row instanceof HTMLElement)) return;
    const viewport = element.getBoundingClientRect();
    const entry = pending.entryId
      ? row.querySelector<HTMLElement>(`[data-work-entry-id="${CSS.escape(pending.entryId)}"]`)
      : null;
    const contentIndex = pending.contentKey ? state?.indexByKey(pending.contentKey) : undefined;
    const content = contentIndex === undefined ? null : state?.elementAtIndex(contentIndex);
    const bounds = (entry ?? row).getBoundingClientRect();
    const delta = resolveDisclosureRevealScrollDelta({
      rowTop: bounds.top,
      rowBottom: content?.getBoundingClientRect().bottom ?? bounds.bottom,
      viewportTop: viewport.top,
      viewportBottom: viewport.bottom,
      composerOverlayHeight: contentInsetEndAdjustment,
      anchorOffset: CHAT_TIMELINE_ANCHOR_OFFSET,
    });
    // Nested lists can finish measuring before their height reaches the outer scroller.
    if (pending.ready && element.scrollTop + delta <= element.scrollHeight - element.clientHeight) {
      disclosureRevealRef.current = null;
    }
    if (delta > 0) {
      element.scrollBy({ top: delta, behavior: prefersReducedMotion ? "auto" : "smooth" });
    }
  });
  const scheduleDisclosureReveal = () => {
    if (disclosureRevealFrameRef.current !== null) {
      cancelAnimationFrame(disclosureRevealFrameRef.current);
    }
    disclosureRevealFrameRef.current = requestAnimationFrame(() => {
      disclosureRevealFrameRef.current = null;
      revealExpandedDisclosure();
    });
  };

  const preserveDisclosurePosition = (
    anchorKey: string,
    reveal?: { readonly entryId?: string | undefined; readonly contentKey?: string | undefined },
  ) => {
    const list = listRef.current;
    disclosureRevealRef.current = null;
    // An anchor ends end-follow until the reader scrolls, so a streaming turn keeps the live end.
    if (!list || (isWorking && list.getState().isFollowingEnd)) return;
    if (reveal) {
      disclosureRevealRef.current = {
        key: anchorKey,
        identity: listIdentityKey,
        entryId: reveal.entryId,
        contentKey: reveal.contentKey,
        ready: false,
      };
    }
    list.cancelScroll();
    list.anchorVisibleContent({ key: anchorKey });
  };

  // Turn and attempt folds reveal later rows rather than growing their own row.
  const onToggleTurnFold = (runId: RunId) => {
    preserveDisclosurePosition(`turn-fold:${runId}`);
    setExpandedRunIds((existing) => {
      const next = new Set(existing);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };
  const onToggleWorkGroup = (groupId: string, anchorKey: string) => {
    preserveDisclosurePosition(
      anchorKey,
      expandedWorkGroupIds.has(groupId) ? undefined : { contentKey: `${groupId}:details` },
    );
    setExpandedWorkGroupIds((existing) => {
      const next = new Set(existing);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };
  const onToggleAttemptFold = (attemptId: RunAttemptId) => {
    preserveDisclosurePosition(`attempt-fold:${attemptId}`);
    setExpandedAttemptIds((existing) => {
      const next = new Set(existing);
      if (next.has(attemptId)) {
        next.delete(attemptId);
      } else {
        next.add(attemptId);
      }
      return next;
    });
  };

  // An interrupted run opens its fold; a newer run closes the previous run's.
  const [observedLatestRun, setObservedLatestRun] = useState({
    identity: listIdentityKey,
    runId: latestRun?.runId,
    status: latestRun?.status,
  });
  if (
    observedLatestRun.identity !== listIdentityKey ||
    observedLatestRun.runId !== latestRun?.runId ||
    observedLatestRun.status !== latestRun?.status
  ) {
    setObservedLatestRun({
      identity: listIdentityKey,
      runId: latestRun?.runId,
      status: latestRun?.status,
    });
    const previousRunId = observedLatestRun.runId;
    if (
      observedLatestRun.identity === listIdentityKey &&
      latestRun &&
      previousRunId !== undefined
    ) {
      if (latestRun.runId === previousRunId) {
        if (observedLatestRun.status === "running" && latestRun.status === "interrupted") {
          setExpandedRunIds((existing) => new Set(existing).add(latestRun.runId));
        }
      } else {
        setExpandedRunIds((existing) => {
          if (!existing.has(previousRunId)) return existing;
          const next = new Set(existing);
          next.delete(previousRunId);
          return next;
        });
      }
    }
  }

  const preferredToolCallVisibility = useClientSettings((settings) => settings.toolCallVisibility);
  const screenReaderAnnouncements = useClientSettings(
    (settings) => settings.screenReaderAnnouncements,
  );
  const toolCallVisibility =
    findActive && preferredToolCallVisibility === "zen" ? "hideAll" : preferredToolCallVisibility;
  const revealedMessageId = citationRequest?.citation.messageId ?? null;
  // Imported turns and post-steer work fold under synthetic keys, not the entries' run ids.
  const findFoldRunIds = findActive
    ? timelineTurnFoldRunIdsByEntryId({
        timelineEntries,
        latestRun,
        runningRunId,
        isWorking,
        runlessWorkActive,
        toolCallVisibility,
        revealedMessageId,
      })
    : null;
  const activeFindRunId =
    findActive && activeFindMatch ? findFoldRunIds?.get(activeFindMatch.entryId) : undefined;
  const [expandedFindRunId, setExpandedFindRunId] = useState<RunId | undefined>();
  if (expandedFindRunId !== activeFindRunId) {
    setExpandedFindRunId(activeFindRunId);
    if (activeFindRunId) {
      setExpandedRunIds((previous) =>
        previous.has(activeFindRunId) ? previous : new Set(previous).add(activeFindRunId),
      );
    }
  }
  // A cited response folded inside a turn opens its fold once per activation;
  // the user can fold it again. Only a citation that can still land opens one.
  // The marker stops the O(entries) fold lookup once the entry is found, since
  // the href stays in the URL after the citation settles.
  const [citationExpandedFor, setCitationExpandedFor] = useState<string | null>(null);
  // Back/Forward can restore an earlier activation key, so the marker clears
  // between activations and a revisit opens the fold again.
  if (!citationRequest && citationExpandedFor !== null) setCitationExpandedFor(null);
  const citedEntry =
    citationRequest &&
    citationExpandedFor !== citationRequest.key &&
    citationHistory._tag !== "failed"
      ? timelineEntries.find(
          (entry) =>
            (entry.kind === "message" &&
              entry.message.role === "assistant" &&
              entry.message.id === citationRequest.citation.messageId) ||
            (entry.kind === "sent-message" && entry.id === citationRequest.citation.messageId),
        )
      : undefined;
  if (citationRequest && citedEntry) {
    const citedRunId = (
      findFoldRunIds ??
      timelineTurnFoldRunIdsByEntryId({
        timelineEntries,
        latestRun,
        runningRunId,
        isWorking,
        runlessWorkActive,
        toolCallVisibility,
        revealedMessageId,
      })
    ).get(citedEntry.id);
    setCitationExpandedFor(citationRequest.key);
    if (citedRunId) {
      setExpandedRunIds((previous) =>
        previous.has(citedRunId) ? previous : new Set(previous).add(citedRunId),
      );
    }
    const citedAttempt = citedEntry.attempt;
    if (citedAttempt?.status === "superseded") {
      setExpandedAttemptIds((previous) =>
        previous.has(citedAttempt.id) ? previous : new Set(previous).add(citedAttempt.id),
      );
    }
  }
  const visibleExpandedRunIds =
    !activeFindRunId || paintedExpandedRunIds.has(activeFindRunId)
      ? paintedExpandedRunIds
      : new Set(paintedExpandedRunIds).add(activeFindRunId);

  const activeFindAttemptId = activeFindMatch
    ? timelineEntries.find((entry) => entry.id === activeFindMatch.entryId)?.attempt?.id
    : undefined;
  const [expandedFindAttemptId, setExpandedFindAttemptId] = useState<RunAttemptId | undefined>();
  if (expandedFindAttemptId !== activeFindAttemptId) {
    setExpandedFindAttemptId(activeFindAttemptId);
    if (activeFindAttemptId) {
      setExpandedAttemptIds((previous) =>
        previous.has(activeFindAttemptId) ? previous : new Set(previous).add(activeFindAttemptId),
      );
    }
  }
  const visibleExpandedAttemptIds =
    activeFindAttemptId && !paintedExpandedAttemptIds.has(activeFindAttemptId)
      ? new Set(paintedExpandedAttemptIds).add(activeFindAttemptId)
      : paintedExpandedAttemptIds;

  const isVisiblePendingApproval = (approval: PendingApproval) =>
    !heldApprovalRequestIds?.has(approval.requestId);
  // A card that was just answered stays in the pending set, marked as leaving, until its exit
  // animation reports it is done; then the resolved row stands in.
  const visiblePendingApprovals = pendingApprovals.filter(isVisiblePendingApproval);
  const visiblePendingKey = visiblePendingApprovals.map((approval) => approval.requestId).join("|");
  const [seenApprovals, setSeenApprovals] =
    useState<ReadonlyMap<RuntimeRequestId, PendingApproval>>(EMPTY_APPROVAL_MAP);
  const [seenApprovalsKey, setSeenApprovalsKey] = useState("");
  const [seenApprovalsIdentity, setSeenApprovalsIdentity] = useState(listIdentityKey);
  const [leavingApprovals, setLeavingApprovals] =
    useState<
      ReadonlyMap<
        RuntimeRequestId,
        { readonly approval: PendingApproval; readonly decision: ProviderApprovalDecision | null }
      >
    >(EMPTY_APPROVAL_MAP);
  if (seenApprovalsIdentity !== listIdentityKey) {
    setSeenApprovalsIdentity(listIdentityKey);
    setSeenApprovals(new Map(visiblePendingApprovals.map((a) => [a.requestId, a])));
    setSeenApprovalsKey(visiblePendingKey);
    setLeavingApprovals(EMPTY_APPROVAL_MAP);
  } else if (seenApprovalsKey !== visiblePendingKey) {
    const current = new Map(visiblePendingApprovals.map((a) => [a.requestId, a]));
    // Held cards moved to the composer and can come back; only a request that is gone from the
    // whole pending list was answered.
    const stillPending = new Set(pendingApprovals.map((approval) => approval.requestId));
    const answered = [...seenApprovals.keys()].filter(
      (id) => !stillPending.has(id) && !leavingApprovals.has(id),
    );
    const staying = [...leavingApprovals].filter(([id]) => !current.has(id));
    setSeenApprovals(current);
    setSeenApprovalsKey(visiblePendingKey);
    if (
      staying.length !== leavingApprovals.size ||
      (answered.length > 0 && !prefersReducedMotion)
    ) {
      setLeavingApprovals(
        new Map([
          ...staying,
          ...(prefersReducedMotion
            ? []
            : answered.map(
                (id) =>
                  [
                    id,
                    {
                      approval: seenApprovals.get(id)!,
                      decision: peekApprovalDecision(id) ?? null,
                    },
                  ] as const,
              )),
        ]),
      );
    }
  }
  const onApprovalLeft = useStableCallback((requestId: RuntimeRequestId) => {
    clearApprovalDecision(requestId);
    setLeavingApprovals((previous) => {
      if (!previous.has(requestId)) return previous;
      const next = new Map(previous);
      next.delete(requestId);
      return next;
    });
  });
  // A leaving card ends when its animations do. Whatever stops that (no card mounted for it, a
  // hidden tab, a removed element) must not keep the request leaving for the rest of the visit.
  const leavingKey = [...leavingApprovals.keys()].join("|");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ends each leaving approval after a fixed time even if its card never reports
  useEffect(() => {
    if (leavingKey === "") return;
    const timers = leavingKey
      .split("|")
      .map((id) =>
        window.setTimeout(() => onApprovalLeft(id as RuntimeRequestId), APPROVAL_LEAVE_FALLBACK_MS),
      );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [leavingKey, onApprovalLeft]);
  // An answer kept for a request this timeline showed, once it is neither waiting nor leaving, is
  // dropped, whichever way the request left (reduced motion skips the leaving state). Answers for
  // requests another timeline shows are not this timeline's to drop.
  const waitingKey = pendingApprovals.map((approval) => approval.requestId).join("|");
  const shownApprovalIds = useRef(new Set<RuntimeRequestId>());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops recorded approval answers for requests that are gone
  useEffect(() => {
    const waiting = new Set(waitingKey === "" ? [] : (waitingKey.split("|") as RuntimeRequestId[]));
    const leaving = new Set(leavingKey === "" ? [] : (leavingKey.split("|") as RuntimeRequestId[]));
    const shown = shownApprovalIds.current;
    for (const id of [...waiting, ...leaving]) shown.add(id);
    const stays = (id: RuntimeRequestId) => waiting.has(id) || leaving.has(id);
    pruneApprovalDecisions(shown, stays);
    for (const id of shown) if (!stays(id)) shown.delete(id);
  }, [waitingKey, leavingKey]);
  const pendingApprovalRequestIds = new Set([
    ...visiblePendingApprovals.map((approval) => approval.requestId),
    ...leavingApprovals.keys(),
  ]);
  // Chat mode keeps a running turn's reads and commands behind the working line.
  const quietedEntryIds =
    chatMode && isWorking && latestRun?.turnEnded !== true
      ? quietedLiveWorkIds(timelineEntries, pendingApprovalRequestIds)
      : undefined;
  const rawRows = useIncrementalTimelineRows(`${listIdentityKey}\0${workspaceRoot ?? ""}`, {
    timelineEntries,
    quietedEntryIds,
    pendingApprovalRequestIds,
    latestRun,
    usageLimitRunId,
    runningRunId,
    expandedRunIds: visibleExpandedRunIds,
    expandedAttemptIds: visibleExpandedAttemptIds,
    expandedWorkGroupIds,
    isWorking,
    runlessWorkActive,
    activeTurnStartedAt,
    turnDiffSummaries,
    supportsConversationRollback,
    threadStartCheckpointAvailable,
    availableRevertTurnCounts,
    worktreeSetup,
    toolCallVisibility,
    revealedMessageId,
  });
  const rows = useStableRows(rawRows, listIdentityKey);
  const arrival = useChatArrival(
    listIdentityKey,
    () =>
      rows.flatMap((row) =>
        row.kind === "message" && row.message.role !== "system"
          ? [{ id: row.id, role: row.message.role, streaming: row.message.streaming }]
          : [],
      ),
    chatMode && !prefersReducedMotion,
  );
  const statusScope = use(ChatStatusScopeContext);
  const noticePlan = chatMode ? planChatNotices(rows) : NO_CHAT_NOTICES;
  const chatSections = chatMode ? deriveChatSections(rows) : NO_CHAT_SECTIONS;
  const preparingWorkspace =
    chatMode && (isPreparingWorktree || worktreeSetup?.phase === "running");
  const quietStatus: ReadonlyArray<ChatStatusItem> = chatMode
    ? [
        ...(preparingWorkspace
          ? [
              {
                id: "workspace",
                kind: "working" as const,
                title: gt("Getting the workspace ready"),
                detail: null,
              },
            ]
          : []),
        ...quietNotices(noticePlan.values()).map((entry) => ({
          id: entry.id,
          kind: "notice" as const,
          title: entry.label,
          detail: noticeDetail(entry),
        })),
      ]
    : [];
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the header's status dot lives outside this tree and reads what the conversation publishes
  useEffect(() => {
    if (!chatMode) return;
    publishChatStatus(statusScope, "conversation", quietStatus);
    return () => publishChatStatus(statusScope, "conversation", []);
  }, [chatMode, quietStatus, statusScope]);
  const [stageLayer, setStageLayer] = useState<HTMLElement | null>(null);
  const turnRunning = isWorking && latestRun?.turnEnded !== true;
  const chatStage = useChatStage(
    listIdentityKey,
    chatMode ? findChatStageTarget(rows, { turnRunning, awaitingPerson: false }) : null,
    // A request that is pending, or leaving, has the screen: the stage waits, and does not return.
    awaitingUser !== null || pendingApprovalRequestIds.size > 0 || leavingApprovals.size > 0,
  );
  const handoffAnswerId =
    chatStage !== null && !chatStage.active ? findHandoffAnswerId(rows, chatStage.userRowId) : null;
  const matchedApprovalRequestIds = new Set<string>();
  for (const row of pendingApprovalRequestIds.size > 0 ? rows : []) {
    const entries =
      row.kind === "work" ? row.groupedEntries : row.kind === "work-live" ? [row.entry] : [];
    for (const entry of entries) {
      const item = entry.projectedItem?.item;
      if (item?.type === "approval_request") matchedApprovalRequestIds.add(item.requestId);
    }
  }
  const unmatchedPendingApprovals = pendingApprovals.filter(
    (approval) =>
      isVisiblePendingApproval(approval) && !matchedApprovalRequestIds.has(approval.requestId),
  );
  // Run status/timestamps change per stream event; keep them out of shared row context.
  const runs = useStableHandoffRuns(runsProp);
  const minimapItems = deriveTimelineMinimapItems(rows);
  const minimapRowIndices = minimapItems.map((item) => item.rowIndex);
  const restoreRowIndex =
    restoringThreadPosition && rememberedPosition?.atEnd === false
      ? rows.findIndex((row) => row.id === rememberedPosition.rowId)
      : -1;
  const restoringAlwaysRender =
    restoringThreadPosition && restoreRowIndex >= 0 ? { indices: [restoreRowIndex] } : undefined;
  const showsEmptyState =
    rows.length === 0 &&
    unmatchedPendingApprovals.length === 0 &&
    !isWorking &&
    parentThreadLink === null &&
    historyControls === undefined &&
    footer === null;
  const [listOpening, setListOpening] = useState<TimelineListOpening>(() =>
    nextListOpening({ mounted: false }, !showsEmptyState, listIdentityKey),
  );
  const nextOpening = nextListOpening(listOpening, !showsEmptyState, listIdentityKey);
  if (nextOpening !== listOpening) setListOpening(nextOpening);
  const listOpenedOn = nextOpening.mounted ? nextOpening.identity : null;
  const viewportRef = useRef<TimelineViewport | null>(null);
  const navigateTimeline = () => viewportRef.current?.navigate({ releasesFollow: true });
  const restoreReady = restoringThreadPosition && rows.length > 0;
  // Z: syncs LegendList's scroll position with which thread it shows. The list
  // is not keyed per thread and reports no "new data" event, and the restore
  // must land before paint, after LegendList's own layout effects applied the
  // new data. A citation request that arrives mid-restore takes over.
  const { findOpenAtOpening } = identityChanged ? { findOpenAtOpening: findOpen } : listState;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores LegendList's scroll position for the shown thread before paint, after the list's own layout
  useLayoutEffect(() => {
    const list = listRef.current;
    const viewport = viewportRef.current;
    if (!restoreReady || !list || !viewport) return;
    return startTimelinePositionRestore({
      list,
      viewport,
      listIdentityKey,
      listOpenedOn,
      rememberedPosition,
      citationPending: citationRequest !== null,
      releaseForFind: findOpenAtOpening,
      onPositioned: setPositionedThreadKey,
    });
  }, [
    citationRequest,
    findOpenAtOpening,
    listIdentityKey,
    listOpenedOn,
    listRef,
    rememberedPosition,
    restoreReady,
    viewportRef,
  ]);

  const [timelineViewportElement, setTimelineViewportElement] = useState<HTMLDivElement | null>(
    null,
  );
  const {
    target: readyCitationRequest,
    positioning: citationPositioning,
    onListLoad: onCitationListLoad,
    alwaysRender: citationAlwaysRender,
  } = useAssistantCitationTarget({
    request: citationRequest,
    phase: citationRequest
      ? resolveCitationPhase({
          history: citationHistory,
          messageId: citationRequest.citation.messageId,
          entries: timelineEntries,
          rows,
        })
      : null,
    viewport: timelineViewportElement,
    onManualNavigation: navigateTimeline,
  });
  const [findListReady, setFindListReady] = useState(false);
  const handleListLoad = () => {
    onCitationListLoad();
    setFindListReady(true);
  };
  const [minimapHasPersistentGutter, setMinimapHasPersistentGutter] = useState(false);
  // Every full-screen viewer reports false when it unmounts, so a row that leaves the list
  // while full screen releases its pin too.
  const onAppFullscreenChange = (rowId: string, fullscreen: boolean) => {
    setFullscreenAppRowId((current) => (fullscreen ? rowId : current === rowId ? null : current));
  };
  const selectedRowIds = useSelectedTimelineRowIds(timelineViewportElement);
  const alwaysRenderIndices = [
    ...(restoringAlwaysRender?.indices ?? []),
    ...timelineRowSpanIndices(rows, selectedRowIds),
  ];
  // Screen readers can only reach headings in the DOM. Keeping the first and
  // last messages mounted lets heading navigation wrap to either end.
  const firstMessageRow = rows.find(isMessageRow);
  const lastMessageRow = rows.findLast(isMessageRow);
  const alwaysRenderKeys = [
    ...(firstMessageRow ? [firstMessageRow.id] : []),
    ...(lastMessageRow && lastMessageRow !== firstMessageRow ? [lastMessageRow.id] : []),
    ...(citationAlwaysRender?.keys ?? []),
    ...(fullscreenAppRowId === null ? [] : [fullscreenAppRowId]),
    ...new Set(
      [...playingAudioRows].filter(([audio]) => audio.isConnected).map(([, rowId]) => rowId),
    ),
  ];
  const alwaysRender =
    alwaysRenderIndices.length === 0 && alwaysRenderKeys.length === 0
      ? undefined
      : {
          ...(alwaysRenderIndices.length === 0 ? {} : { indices: alwaysRenderIndices }),
          ...(alwaysRenderKeys.length === 0 ? {} : { keys: alwaysRenderKeys }),
        };
  const [minimapHitStrip, setMinimapHitStrip] = useState({ left: 0, width: 0 });
  const [minimapCurrentIndex, setMinimapCurrentIndex] = useState<number | null>(null);
  // The turn the Chat outline marks, by message id and thread, so it never outlives either.
  const [outlineCurrent, setOutlineCurrent] = useState<{
    readonly threadKey: string;
    readonly id: string;
  } | null>(null);
  const [minimapAtEnd, setMinimapAtEnd] = useState(false);
  const outlineShownRef = useRef(false);
  const chatProgressRef = useRef<HTMLDivElement | null>(null);
  const handleAnchorReady = (info: { anchorIndex: number | undefined }) => {
    if (anchorMessageId !== null && info.anchorIndex !== undefined) {
      onAnchorReady(anchorMessageId, info.anchorIndex);
    }
  };
  const handleAnchorSizeChanged = (size: number) => {
    if (anchorMessageId !== null) {
      onAnchorSizeChanged(anchorMessageId, size);
    }
  };
  const anchoredEndSpaceConfig = resolveChatListAnchoredEndSpace(
    rows,
    anchorMessageId,
    (row) => (row.kind === "message" && row.message.role === "user" ? row.message.id : null),
    { anchorOffset: CHAT_TIMELINE_ANCHOR_OFFSET },
  );
  const anchoredEndSpace = anchoredEndSpaceConfig
    ? {
        ...anchoredEndSpaceConfig,
        onReady: handleAnchorReady,
        onSizeChanged: handleAnchorSizeChanged,
      }
    : undefined;
  const maintainVisibleContentPosition = {
    data: true,
    size: true,
  };

  const refreshMinimap = useStableCallback(() => {
    const state = listRef.current?.getState?.();
    if (restoringThreadPosition || state?.data !== rows) return;
    if (!state || minimapItems.length === 0) {
      return;
    }

    const firstBufferedIndex = state.startBuffered;
    const firstBufferedRow: HTMLElement | undefined =
      firstBufferedIndex == null ? undefined : state.elementAtIndex(firstBufferedIndex);
    const firstBufferedTop =
      firstBufferedIndex == null ? undefined : state.positionAtIndex(firstBufferedIndex);
    const viewport = listRef.current?.getScrollableNode() ?? undefined;
    // Cached row positions exclude the header and pending scroll adjustments.
    const scroll =
      firstBufferedRow && viewport && firstBufferedTop !== undefined
        ? firstBufferedTop +
          viewport.getBoundingClientRect().top -
          firstBufferedRow.getBoundingClientRect().top
        : state.scroll;
    const visibleRange = resolveTimelineMinimapVisibleRange({ ...state, scroll });
    // Each tick sits where its turn sits in the whole thread, so the ladder reads as a map.
    const lastRow = rows.length - 1;
    const total =
      lastRow < 0 ? 0 : (state.positionAtIndex(lastRow) ?? 0) + (state.sizeAtIndex(lastRow) ?? 0);
    for (const [index, item] of minimapItems.entries()) {
      const strip = minimapStripMap.get(item.id);
      const position = state.positionAtIndex(item.rowIndex);
      if (strip && total > 0 && position !== undefined) {
        const top = `${Math.min(100, Math.max(0, (position / total) * 100)).toFixed(2)}%`;
        if (strip.style.top !== top) strip.style.top = top;
      }
      const inView = isTimelineMinimapTurnVisible(
        item.rowIndex,
        minimapItems[index + 1]?.rowIndex,
        visibleRange.start,
        visibleRange.end,
      );
      const next = inView ? "true" : "false";
      // Avoid dirtying style state on every scroll tick for unchanged strips.
      if (strip && strip.dataset.inView !== next) {
        strip.dataset.inView = next;
      }
    }
    // Ignore rows ending within the offset minimap navigation leaves above its target, or
    // Next turn keeps retargeting the same row. 1px absorbs device-pixel scroll rounding.
    const currentInset = TIMELINE_MINIMAP_TARGET_OFFSET + 1;
    const currentRange = resolveTimelineMinimapVisibleRange({
      ...state,
      scroll: scroll + currentInset,
      scrollLength: state.scrollLength - currentInset,
    });
    const nextCurrentIndex = resolveTimelineMinimapCurrentIndex({
      visibleStart: currentRange.start,
      visibleEnd: currentRange.end,
      rowIndices: minimapRowIndices,
    });
    setMinimapCurrentIndex((current) =>
      current === nextCurrentIndex ? current : nextCurrentIndex,
    );
    // The exact bottom, not the follow re-arm zone: Next can still scroll inside that zone.
    const physicallyAtEnd =
      viewport !== undefined &&
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 1;
    if (chatMode && outlineShownRef.current) {
      const outlineIndex = resolveOutlineCurrentIndex({
        count: minimapItems.length,
        topAt: (index) => state.positionAtIndex(minimapItems[index]!.rowIndex) ?? 0,
        scroll,
        viewportHeight: state.scrollLength,
        atEnd: physicallyAtEnd,
      });
      const id = outlineIndex === null ? undefined : minimapItems[outlineIndex]?.id;
      setOutlineCurrent((current) =>
        id === undefined
          ? null
          : current?.id === id && current.threadKey === listIdentityKey
            ? current
            : { threadKey: listIdentityKey, id },
      );
    }
    setMinimapAtEnd(physicallyAtEnd);
    const progressTrack = chatProgressRef.current;
    if (chatMode && progressTrack && viewport) {
      const range = viewport.scrollHeight - viewport.clientHeight;
      const read = range > 1 ? Math.min(1, Math.max(0, viewport.scrollTop / range)) : 0;
      progressTrack.style.setProperty("--one-chat-read", read.toFixed(3));
      // Shown while a long answer is being read; the finished page needs no line.
      progressTrack.style.setProperty(
        "--one-chat-read-visible",
        range > 1 && viewport.scrollTop > 8 && !physicallyAtEnd ? "1" : "0",
      );
    }
  });

  const minimapRefreshFrameRef = useRef<number | null>(null);
  const scheduleMinimapRefresh = useStableCallback(() => {
    if (minimapRefreshFrameRef.current !== null) return;
    // LegendList recycles row containers before React commits their positions.
    minimapRefreshFrameRef.current = requestAnimationFrame(() => {
      minimapRefreshFrameRef.current = null;
      refreshMinimap();
    });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the minimap skips refreshes until the restore commits, and the restore can land without a scroll event
  useLayoutEffect(() => {
    if (!restoringThreadPosition) scheduleMinimapRefresh();
  }, [restoringThreadPosition, scheduleMinimapRefresh]);

  // The outline mark is measured only while the outline shows; showing it needs a first measurement.
  const onOutlineShownChange = useStableCallback((shown: boolean) => {
    outlineShownRef.current = shown;
    if (shown) scheduleMinimapRefresh();
  });

  // The measurement the last remember wrote, so a follow release can rewrite
  // it without reading render state from a listener.
  const lastRememberedRef = useRef<{
    readonly data: unknown;
    readonly threadKey: string;
    readonly position: Parameters<typeof rememberTimelinePosition>[1];
  } | null>(null);
  const rememberPosition = (followingEnd: boolean) => {
    const state = listRef.current?.getState?.();
    if (restoringThreadPosition || state?.data !== rows) return;
    const isAtEnd = resolveTimelineIsAtEnd(state);
    const position = state.data.length ? resolveWorkGroupScrollAnchor(state) : undefined;
    if (position && isAtEnd !== undefined) {
      const index = state.indexByKey(position.rowId);
      const row = index === undefined ? undefined : state.elementAtIndex(index);
      const element = listRef.current?.getScrollableNode();
      if (row && element) {
        const measured = {
          ...position,
          offsetWithinRow: element.getBoundingClientRect().top - row.getBoundingClientRect().top,
          scrollOffset: element.scrollTop,
          atEnd: isAtEnd,
          disclosures: {
            runs: paintedExpandedRunIds,
            workGroups: paintedExpandedWorkGroupIds,
            attempts: paintedExpandedAttemptIds,
            workGroupState: workGroupViewState,
          },
        };
        lastRememberedRef.current = { data: rows, threadKey: listIdentityKey, position: measured };
        rememberTimelinePosition(listIdentityKey, measured, followingEnd);
      }
    }
    return isAtEnd;
  };
  // A follow release without a scroll after it would leave the position
  // remembered as following.
  const rememberReleasedPosition = () => {
    const last = lastRememberedRef.current;
    if (last && listRef.current?.getState().data === last.data) {
      rememberTimelinePosition(last.threadKey, last.position, false);
    }
  };

  // The turn ladder shows while the list scrolls and for a moment after; a flag on the scroller
  // drives it from CSS, so a scroll event never renders React.
  const scrollingFlagTimerRef = useRef<number | null>(null);
  const flagScrolling = () => {
    const viewport = listRef.current?.getScrollableNode();
    if (!viewport) return;
    viewport.dataset.scrolling = "";
    // The ladder's CSS reads the flag on this timeline's own container, so scrolling one timeline
    // does not show every other timeline's ladder, and no `:has()` rule on `html` is needed.
    const area = viewport.closest<HTMLElement>("[data-assistant-citation-viewport]");
    area?.setAttribute("data-timeline-scrolling", "");
    if (scrollingFlagTimerRef.current !== null) window.clearTimeout(scrollingFlagTimerRef.current);
    scrollingFlagTimerRef.current = window.setTimeout(() => {
      delete viewport.dataset.scrolling;
      area?.removeAttribute("data-timeline-scrolling");
      scrollingFlagTimerRef.current = null;
    }, 900);
  };

  // The first screen of this thread is ready once its rows (or its empty state, for an empty thread)
  // are laid out and two frames have been drawn. Thread changes clear it. The same state is on the
  // timeline root as `data-first-screen-ready` and in `firstScreenReady.ts`, for whatever has to
  // wait for the thread to be readable. A timeline that never settles reports ready after 90 frames.
  const rowCount = rows.length;
  // An empty thread or one still loading has no scroller; its placeholder is the root then.
  const [placeholderRoot, setPlaceholderRoot] = useState<HTMLDivElement | null>(null);
  const firstScreenRoot = timelineViewportElement ?? placeholderRoot;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the first-screen flag when the thread changes or the timeline goes away
  useEffect(() => {
    setFirstScreenReady(listIdentityKey, false);
    return () => setFirstScreenReady(listIdentityKey, false);
  }, [listIdentityKey]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- waits for the first rows to be laid out and painted, then marks the first screen ready
  useEffect(() => {
    const root = firstScreenRoot;
    // Remembered rows shown while the thread loads are a first screen; an empty list is not.
    if (!root || (detailLoading && rowCount === 0) || restoringThreadPosition) return;
    const dropAttribute = () => root.removeAttribute("data-first-screen-ready");
    if (isFirstScreenReady(listIdentityKey)) {
      // This thread already reported; only the root it is shown on has changed.
      root.setAttribute("data-first-screen-ready", "");
      return dropAttribute;
    }
    let frame = 0;
    let frames = 0;
    let cancelled = false;
    const markReady = () => {
      if (cancelled) return;
      root.setAttribute("data-first-screen-ready", "");
      setFirstScreenReady(listIdentityKey, true);
    };
    const check = () => {
      if (cancelled) return;
      frames += 1;
      const laidOut =
        rowCount === 0 ||
        [...root.querySelectorAll(".messages-timeline-row-frame")].some(
          (row) => row.getBoundingClientRect().height > 0,
        );
      if (laidOut || frames >= 90) {
        // Two frames: one to draw the rows, one so the draw has reached the screen.
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(markReady);
        });
        return;
      }
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      dropAttribute();
    };
  }, [detailLoading, firstScreenRoot, listIdentityKey, restoringThreadPosition, rowCount]);

  const handleScroll = () => {
    flagScrolling();
    if (restoringThreadPosition || listRef.current?.getState?.().data !== rows) return;
    const isAtEnd = rememberPosition(liveFollowEnabled && !anchoredEndSpace);
    if (isAtEnd !== undefined && !citationPositioning) {
      onIsAtEndChange(isAtEnd);
    }
    scheduleMinimapRefresh();
  };

  const measureTimelineGutter = (viewportElement: HTMLElement) => {
    const viewportWidth = viewportElement.getBoundingClientRect().width;
    const contentWidth =
      viewportElement.querySelector<HTMLElement>("[data-timeline-root]")?.getBoundingClientRect()
        .width ?? viewportWidth;
    const nextHasPersistentGutter = resolveTimelineMinimapHasPersistentGutter(
      viewportWidth,
      contentWidth,
    );
    setMinimapHasPersistentGutter((current) =>
      current === nextHasPersistentGutter ? current : nextHasPersistentGutter,
    );
    const nextHitStrip = resolveTimelineMinimapHitStrip(viewportWidth, contentWidth);
    setMinimapHitStrip((current) =>
      current.left === nextHitStrip.left && current.width === nextHitStrip.width
        ? current
        : nextHitStrip,
    );
  };
  // Rows added, removed or rewrapped (chat width) change the content size,
  // which moves the scroll position, the overflow, and the content lane width.
  const handleContentSizeChanged = useStableCallback((laidOutData: unknown) => {
    // The first laid-out content of a newly shown thread ends its settling; a
    // frame the previous thread scheduled laid out the previous thread's rows.
    if (laidOutData === rows) {
      setSettlingListIdentity((current) => (current === listIdentityKey ? null : current));
    }
    handleScroll();
  });
  // The content lane only changes width with the viewport or the chat width
  // setting, never with streamed content; measuring per content frame would
  // force a layout on every chunk.
  const measuredLaneWidthRef = useRef<number | null>(null);
  const observeLaneWidth = (lane: HTMLDivElement | null) => {
    if (!lane) return;
    return observeResize(lane, (entries) => {
      const width = entries.at(-1)?.contentRect.width;
      if (width === undefined || width === measuredLaneWidthRef.current) return;
      measuredLaneWidthRef.current = width;
      const viewportElement = lane.closest<HTMLElement>("[data-assistant-citation-viewport]");
      if (viewportElement) measureTimelineGutter(viewportElement);
    });
  };
  const attachTimelineViewportElement = (viewportElement: HTMLDivElement | null) => {
    setTimelineViewportElement(viewportElement);
    if (!viewportElement) return;
    const stopObserving = observeResize(viewportElement, () => {
      measureTimelineGutter(viewportElement);
      scheduleMinimapRefresh();
    });
    return () => {
      stopObserving();
      setTimelineViewportElement(null);
    };
  };

  // Built from props after the last hook so the compiler can memoize the row context; a map
  // made before a hook would rebuild it, and re-render every row, on each streamed update.
  const pendingApprovalsByRequestId = new Map([
    ...visiblePendingApprovals.map((approval) => [approval.requestId, approval] as const),
    ...[...leavingApprovals].map(([id, leaving]) => [id, leaving.approval] as const),
  ]);
  const leavingDecisions = new Map(
    [...leavingApprovals].map(([id, leaving]) => [id, leaving.decision] as const),
  );
  const approvalSubjects = deriveApprovalSubjects(timelineEntries, pendingApprovalRequestIds);
  const followUpTarget = chatMode
    ? resolveChatFollowUpTarget(rows, {
        turnRunning: isWorking,
        awaitingPerson: awaitingUser !== null || pendingApprovalRequestIds.size > 0,
        composerRef,
      })
    : NO_FOLLOW_UP;
  // When the turn ends the follow-ups open beneath the answer. The list must not follow that
  // growth to the end: text being read never moves, the extent just grows below it. The hold lasts
  // as long as what caused it: until the entrance motion has finished (at once without motion), and
  // it ends the moment a new message or a new turn arrives, which the list then follows.
  const followUpsReady = followUpTarget.ready;
  const [followUpsWereReady, setFollowUpsWereReady] = useState(followUpsReady);
  const [endHold, setEndHold] = useState({ holding: false, rows: 0 });
  const holdingEnd = endHold.holding;
  if (followUpsReady !== followUpsWereReady) {
    setFollowUpsWereReady(followUpsReady);
    if (followUpsReady) setEndHold({ holding: true, rows: rows.length });
  }
  if (endHold.holding && (isWorking || rows.length !== endHold.rows)) {
    setEndHold({ holding: false, rows: 0 });
  }
  // Anything the person does that makes an answer taller (a quiz revealing its explanation) asks
  // for the same hold.
  const holdEnd = useStableCallback(() => setEndHold({ holding: true, rows: rows.length }));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the hold ends when the finite animations under the list have, which only the document timeline knows
  useEffect(() => {
    if (!endHold.holding) return;
    let live = true;
    const release = () => {
      if (live) setEndHold((hold) => ({ ...hold, holding: false }));
    };
    // Two frames on: a transition begins at the first style update after the change.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const running = (timelineViewportElement?.getAnimations({ subtree: true }) ?? []).filter(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
        );
        if (running.length === 0) release();
        else void Promise.allSettled(running.map((animation) => animation.finished)).then(release);
      });
    });
    return () => {
      live = false;
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [endHold, timelineViewportElement]);
  const sharedState: TimelineRowSharedState = {
    pendingApprovals: pendingApprovalsByRequestId,
    leavingApprovals: leavingDecisions,
    onApprovalLeft,
    approvalChordHints: showApprovalChordHints,
    respondingRequestIds,
    canOperateThread,
    onRespondToApproval,
    citationRequest: readyCitationRequest,
    onReplyToResponse,
    listRef,
    timestampFormat,
    routeThreadKey,
    threadRef: citationThreadRef,
    markdownCwd,
    resolvedTheme,
    workspaceRoot,
    skills,
    runs,
    activeThreadEnvironmentId,
    onRevertToTurnCount,
    onRunShellCommand,
    findActive,
    onImageExpand,
    onFileOpen,
    onUseArtifactTemplate,
    onSendAppMessage,
    onAppFullscreenChange,
    onFileDownload,
    openPullRequest,
    onOpenToolDiff,
    onOpenThread,
    renderHtmlRender,
    turnItemSource,
    workflowOpening,
    onForkFromRun,
    onToggleTurnFold,
    onToggleAttemptFold,
    onToggleWorkGroup,
    onToggleWorkEntry: (anchorKey, collapsed, entryId) =>
      preserveDisclosurePosition(anchorKey, collapsed ? undefined : { entryId }),
    onWorkEntryContentReady: (anchorKey, entryId) => {
      const pending = disclosureRevealRef.current;
      if (
        !pending ||
        pending.identity !== listIdentityKey ||
        (pending.contentKey === undefined
          ? pending.key !== anchorKey || pending.entryId !== entryId
          : pending.contentKey !== anchorKey)
      )
        return;
      // A row opens over its height animation: the content counts as ready, and the reveal scrolls
      // to it, once its animations end and the height is final. With none running (reduced
      // motion) that is now.
      const markReady = () => {
        if (disclosureRevealRef.current !== pending) return;
        pending.ready = pending.contentKey === undefined;
        scheduleDisclosureReveal();
      };
      const state = listRef.current?.getState();
      const index = state?.indexByKey(anchorKey);
      const row = index === undefined ? undefined : state?.elementAtIndex(index);
      const animations = row instanceof HTMLElement ? row.getAnimations({ subtree: true }) : [];
      if (animations.length === 0) {
        markReady();
        return;
      }
      void Promise.all(
        animations.map((animation) => animation.finished.catch(() => undefined)),
      ).then(markReady);
    },
    onCancelWorktreeSetup: onCancelWorktreeSetup ?? null,
    retryableWorkspacePreparationRunIds,
    onRetryWorkspacePreparation: onRetryWorkspacePreparation ?? null,
    onWorktreeSetupWorkLocally: onWorktreeSetupWorkLocally ?? null,
    onOpenWorktreeSetupTerminal: onOpenWorktreeSetupTerminal ?? null,
    workGroupViewState,
  };
  const compactionAwaitingRow =
    isCompacting &&
    !rows.some(
      (row) =>
        (row.kind === "context-compaction" && row.active) ||
        (row.kind === "working" && row.compacting),
    );
  const backgroundWorktreeSetup =
    worktreeSetup !== null &&
    worktreeSetup.phase === "running" &&
    worktreeSetupAgentStarted(worktreeSetup) &&
    latestRun?.startedAt != null
      ? worktreeSetup
      : null;
  const activityState: TimelineRowActivityState = {
    isWorking,
    isCompacting: compactionAwaitingRow,
    isRevertingCheckpoint,
    backgroundWorktreeSetup,
    awaitingUser: awaitingUser !== null,
    isPreparingWorktree,
    providerStartingLabel,
    providerStarting,
    latestRunId: latestRun?.runId ?? null,
    liveAnswerPreview:
      isWorking && toolCallVisibility === "zen" ? liveAnswerPreview(timelineEntries) : null,
  };
  // Mounted in both the empty and filled timeline so a thread's first turn
  // starts from a baseline instead of a fresh, silent region.
  const activityAnnouncer = (
    <ThreadActivityAnnouncer
      threadKey={announceTurnStatus ? listIdentityKey : null}
      status={awaitingUser ?? (isWorking ? "working" : "idle")}
      requestId={awaitingRequestId}
      runId={announcedRun?.runId ?? null}
      runStatus={announcedRun?.status ?? null}
      detailBehind={detailBehindShell}
      level={screenReaderAnnouncements}
      entries={screenReaderAnnouncements === "status" ? EMPTY_TIMELINE_ENTRIES : timelineEntries}
      workspaceRoot={workspaceRoot}
    />
  );
  const listHeaderLeadingContent =
    parentThreadLink === null ? (
      topFadeEnabled ? (
        TIMELINE_LIST_FADE_HEADER
      ) : (
        TIMELINE_LIST_HEADER
      )
    ) : (
      <div className="messages-timeline-row-frame">
        <div className="chat-content-lane pt-1 sm:pt-2">
          <TimelineSystemDivider
            label={
              parentThreadLink.relation?.label ??
              (parentThreadLink.sideChat
                ? gt("Context from", {
                    $context: "divider label; the parent thread title follows as a link",
                  })
                : gt("Subagent of", {
                    $context: "divider label; the parent thread title follows as a link",
                  }))
            }
            detail={
              parentThreadLink.environmentLabel === undefined
                ? parentThreadLink.title
                : gt("{title} on {environment}", {
                    title: parentThreadLink.title,
                    environment: parentThreadLink.environmentLabel,
                  })
            }
            icon={parentThreadLink.sideChat ? MessagesSquareIcon : BotIcon}
            {...(parentThreadLink.open === undefined
              ? {}
              : {
                  actionLabel: parentThreadLink.relation?.actionLabel ?? gt("Open parent thread"),
                  onAction: parentThreadLink.open,
                })}
          />
        </div>
      </div>
    );
  const listHeader = (
    <>
      {parentThreadLink === null ? listHeaderLeadingContent : null}
      {historyControls ? <TimelineHistoryControl {...historyControls} /> : null}
      {parentThreadLink !== null ? listHeaderLeadingContent : null}
    </>
  );

  const registerTimeline = canvas?.registerTimeline;
  const shouldPreserveReadingPosition = useStableCallback(
    () =>
      !liveFollowEnabled &&
      !anchoredEndSpace &&
      !findActive &&
      !citationPositioning &&
      !restoringThreadPosition,
  );
  // Stable so the list attaches once per mount, not on every render.
  const setTimelineList = useStableCallback((list: LegendListRef | null) => {
    listRef.current = list;
    const scrollNode: HTMLElement | null = list?.getScrollableNode() ?? null;
    registerTimeline?.(scrollNode);
    const viewport = scrollNode
      ? attachTimelineViewport(scrollNode, (frame) => {
          const rowId = frame.closest<HTMLElement>("[data-timeline-row-id]")?.dataset.timelineRowId;
          if (rowId && list) {
            list.cancelScroll();
            list.anchorVisibleContent({ key: rowId });
          }
        })
      : null;
    viewportRef.current = viewport;
    const stopPreservingReadingPosition = scrollNode
      ? preserveReadingPosition(scrollNode, shouldPreserveReadingPosition)
      : undefined;
    const detachViewport = viewport ? onViewportAttach?.(viewport) : undefined;
    const stopRememberingRelease = viewport?.onFollowReleased(rememberReleasedPosition);
    const stopDisclosureReveal = viewport?.subscribe(() => {
      disclosureRevealRef.current = null;
    });
    let contentSizeFrame: number | null = null;
    // LegendList lays rows out from layout effects; the next frame sees them settled.
    let scheduledData: unknown = null;
    const scheduleContentSizeChanged = () => {
      if (!list) return;
      const laidOutData = list.getState().data;
      if (contentSizeFrame !== null) {
        if (scheduledData === laidOutData) return;
        cancelAnimationFrame(contentSizeFrame);
      }
      scheduledData = laidOutData;
      contentSizeFrame = requestAnimationFrame(() => {
        contentSizeFrame = null;
        handleContentSizeChanged(laidOutData);
        revealExpandedDisclosure();
      });
    };
    const stopListeningToContentSize = list
      ?.getState()
      .listen("totalSize", () => scheduleContentSizeChanged());
    scheduleContentSizeChanged();
    return () => {
      stopListeningToContentSize?.();
      stopPreservingReadingPosition?.();
      stopRememberingRelease?.();
      stopDisclosureReveal?.();
      if (contentSizeFrame !== null) cancelAnimationFrame(contentSizeFrame);
      if (disclosureRevealFrameRef.current !== null) {
        cancelAnimationFrame(disclosureRevealFrameRef.current);
        disclosureRevealFrameRef.current = null;
      }
      detachViewport?.();
      viewport?.dispose();
      if (viewportRef.current === viewport) viewportRef.current = null;
      if (minimapRefreshFrameRef.current !== null) {
        cancelAnimationFrame(minimapRefreshFrameRef.current);
        minimapRefreshFrameRef.current = null;
      }
      listRef.current = null;
      registerTimeline?.(null);
    };
  });

  useThreadFindPositionReader({
    threadKey: listIdentityKey,
    navigate: navigateTimeline,
    timelineViewportElement,
    findFoldRunIds,
    timelineEntries,
    latestRun,
    runningRunId,
    isWorking,
    runlessWorkActive,
    toolCallVisibility,
    rows,
    contentInsetEndAdjustment,
  });

  useThreadFindNavigation({
    // Find reveals its match only after the opening restore settles; both
    // scroll the list directly, so the restore would otherwise pull it back.
    listReady: findListReady && !restoringThreadPosition,
    historyControls,
    entries: timelineEntries,
    container: timelineViewportElement,
    query: normalizedFindQuery,
    match: activeFindMatch,
    navigationId: findNavigationId,
    rowIndex: activeFindMatch ? rows.findIndex((row) => row.id === activeFindMatch.entryId) : -1,
    listRef,
    contentInsetEndAdjustment,
  });

  // LegendList moves rows one commit late; per-row providers prevent thread context leaks.
  const onAudioPlaybackChange = (rowId: string, event: SyntheticEvent) => {
    const audio = event.target;
    if (!(audio instanceof HTMLAudioElement)) return;
    setPlayingAudioRows((current) => {
      const playing = !audio.paused && !audio.ended;
      if (playing === current.has(audio)) return current;
      const next = new Map(current);
      if (playing) next.set(audio, rowId);
      else next.delete(audio);
      return next;
    });
  };
  const onAudioUnmount = useStableCallback((audio: HTMLAudioElement) => {
    setPlayingAudioRows((current) => {
      if (!current.has(audio)) return current;
      const next = new Map(current);
      next.delete(audio);
      return next;
    });
  });
  const renderItem = ({ item }: { item: MessagesTimelineRow }) => (
    <TimelineRowCtx value={sharedState}>
      <div
        className="messages-timeline-row-frame"
        onPlayCapture={(event) => onAudioPlaybackChange(item.id, event)}
        onPauseCapture={(event) => onAudioPlaybackChange(item.id, event)}
        onEndedCapture={(event) => onAudioPlaybackChange(item.id, event)}
      >
        <div
          ref={observeLaneWidth}
          // An HTML preview can run wider than this lane, which stays the chat column's width.
          className={cn("chat-content-lane", item.kind !== "html-render" && "overflow-x-clip")}
          data-timeline-root="true"
        >
          <AudioPreviewUnmountContext value={onAudioUnmount}>
            <ChatArrivalContext value={arrival}>
              <ChatHandoffAnswerContext value={handoffAnswerId}>
                <ChatStageContext value={chatStage}>
                  <ChatStageLayerContext value={stageLayer}>
                    <ChatEndHoldContext value={holdEnd}>
                      <ApprovalSubjectContext value={approvalSubjects}>
                        <ChatNoticePlanContext value={noticePlan}>
                          <ChatFollowUpContext value={followUpTarget}>
                            <TimelineRowContent row={item} />
                          </ChatFollowUpContext>
                        </ChatNoticePlanContext>
                      </ApprovalSubjectContext>
                    </ChatEndHoldContext>
                  </ChatStageLayerContext>
                </ChatStageContext>
              </ChatHandoffAnswerContext>
            </ChatArrivalContext>
          </AudioPreviewUnmountContext>
        </div>
      </div>
    </TimelineRowCtx>
  );
  // The list redraws rows from this; a finished arrival animation must reach them.
  const listExtraData = {
    identity: listIdentityKey,
    rowCount: rows.length,
    sharedState,
    arrivalFresh: arrival.fresh,
    approvalSubjects,
    noticePlan,
    followUpTarget,
    handoffAnswerId,
  };
  const timelineListFooter = (
    <TimelineListFooter
      composerInset={anchoredEndSpace ? 0 : contentInsetEndAdjustment}
      onGrow={onFooterGrow}
    >
      {footer}
      {unmatchedPendingApprovals.length > 0 ? (
        <TimelineRowCtx value={sharedState}>
          <div className="messages-timeline-row-frame">
            <div className="chat-content-lane overflow-x-clip" data-timeline-root="true">
              <WorkLogBlock>
                {unmatchedPendingApprovals.map((approval) => (
                  <TimelinePendingApprovalRow key={approval.requestId} approval={approval} />
                ))}
              </WorkLogBlock>
            </div>
          </div>
        </TimelineRowCtx>
      ) : null}
    </TimelineListFooter>
  );

  const forwardMinimapWheel = (event: WheelEvent) => {
    const scrollNode = listRef.current?.getScrollableNode();
    if (scrollNode) forwardWheelToTimeline(event, scrollNode);
  };
  const selectMinimapItem = (item: (typeof minimapItems)[number]) => {
    navigateTimeline();
    void listRef.current?.scrollToIndex({
      index: item.rowIndex,
      animated: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      viewOffset: TIMELINE_MINIMAP_TARGET_OFFSET,
    });
  };
  // A heading is scrolled to once its row has mounted, which the jump to the row causes.
  const selectChatSection = (section: ChatSection) => {
    navigateTimeline();
    void listRef.current?.scrollToIndex({ index: section.rowIndex, animated: false });
    const reveal = () => {
      const row = timelineViewportElement?.querySelector(
        `[data-message-id="${CSS.escape(section.messageId)}"]`,
      );
      const heading = row?.querySelectorAll(".chat-markdown > :is(h1, h2, h3)")[
        section.headingIndex
      ];
      heading?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(reveal));
  };
  const minimap = (
    <TimelineMinimap
      items={minimapItems}
      hasPersistentGutter={minimapHasPersistentGutter}
      hitStrip={minimapHitStrip}
      currentIndex={minimapCurrentIndex}
      atEnd={minimapAtEnd}
      stripMap={minimapStripMap}
      onWheel={forwardMinimapWheel}
      onSelect={selectMinimapItem}
    />
  );

  if (showsEmptyState) {
    if (hideEmptyPlaceholder) {
      return (
        <>
          {activityAnnouncer}
          <div ref={setPlaceholderRoot} className="h-full min-h-0" data-timeline-loading="true" />
        </>
      );
    }
    return (
      <>
        {activityAnnouncer}
        <div
          ref={setPlaceholderRoot}
          className="flex h-full items-center justify-center ps-(--chat-lane-inset-start) pe-(--chat-lane-inset-end)"
          style={{ paddingBottom: emptyPlaceholderInset }}
        >
          <OneEmptyState />
        </div>
      </>
    );
  }

  return (
    <>
      {activityAnnouncer}
      <MarkdownFindContext value={findActive}>
        <TimelineRowActivityCtx value={activityState}>
          <TooltipScrollDismissArea
            ref={attachTimelineViewportElement}
            className="relative h-full min-h-0"
            data-assistant-citation-viewport="true"
          >
            {onCiteAssistantText && citationThreadRef ? (
              <AssistantSelectionToolbar
                viewport={timelineViewportElement}
                threadRef={citationThreadRef}
                onCite={onCiteAssistantText}
              />
            ) : null}
            <LegendList<MessagesTimelineRow>
              ref={setTimelineList}
              data={rows}
              extraData={listExtraData}
              keyExtractor={keyExtractor}
              getItemType={getItemType}
              renderItem={renderItem}
              estimatedItemSize={90}
              initialScrollAtEnd={
                !findActive && citationRequest === null && rememberedPosition?.atEnd !== false
              }
              // Legend needs a data refresh to mount new pins without a scroll event.
              dataVersion={`${readyCitationRequest?.key ?? listIdentityKey}:${alwaysRenderKeys.join(",")}`}
              {...(alwaysRender ? { alwaysRender } : {})}
              onLoad={handleListLoad}
              {...(anchoredEndSpace ? { anchoredEndSpace } : {})}
              contentInsetEndAdjustment={anchoredEndSpace ? contentInsetEndAdjustment : 0}
              maintainScrollAtEnd={
                citationPositioning ||
                (restoringThreadPosition && rememberedPosition?.atEnd === false) ||
                anchoredEndSpace ||
                holdingEnd ||
                !liveFollowEnabled ||
                fullscreenAppRowId !== null
                  ? false
                  : isWorking && !syncing && !prefersReducedMotion && settlingListIdentity === null
                    ? TIMELINE_MAINTAIN_SCROLL_AT_END_SMOOTH
                    : TIMELINE_MAINTAIN_SCROLL_AT_END
              }
              // A restore owns the scroll position until it lands. Anchoring would
              // move it for the previous thread's header as the list swaps threads.
              maintainVisibleContentPosition={
                findActive || citationPositioning || restoringThreadPosition
                  ? false
                  : maintainVisibleContentPosition
              }
              maintainScrollAtEndThreshold={1}
              onScroll={handleScroll}
              onItemSizeChanged={scheduleMinimapRefresh}
              onMetricsChange={scheduleMinimapRefresh}
              // Keyboard scrolling only moves the focused element; F6 and clicks land here.
              tabIndex={-1}
              data-workspace-focus-default
              className={cn(
                "messages-timeline-scroll scrollbar-gutter-both h-full min-h-0 overflow-x-hidden overscroll-y-contain [overflow-anchor:none]",
                topFadeEnabled && "topbar-scroll-fade",
              )}
              ListHeaderComponent={listHeader}
              ListFooterComponent={timelineListFooter}
            />
            {chatMode ? <div ref={setStageLayer} className="one-chat-stage-layer" /> : null}
            {chatMode ? (
              <ChatNav
                items={minimapItems}
                currentId={outlineCurrent?.threadKey === listIdentityKey ? outlineCurrent.id : null}
                threadKey={listIdentityKey}
                onSelect={selectMinimapItem}
                sections={chatSections}
                onSelectSection={selectChatSection}
                onWheel={forwardMinimapWheel}
                onShownChange={onOutlineShownChange}
                progressRef={chatProgressRef}
              >
                {minimap}
              </ChatNav>
            ) : (
              minimap
            )}
          </TooltipScrollDismissArea>
        </TimelineRowActivityCtx>
      </MarkdownFindContext>
    </>
  );
});

function TimelineHistoryControl(props: MessagesTimelineHistoryControls) {
  const gt = useGT();
  const messages = useMessages();
  if (!props.hasMoreHistory && props.error === null) {
    return null;
  }
  return (
    <div className="messages-timeline-row-frame">
      <div className="chat-content-lane flex flex-col gap-1.5 pb-2">
        {props.hasMoreHistory ? (
          <button
            type="button"
            disabled={props.loading}
            aria-label={gt("Load earlier turns")}
            onClick={() => props.onLoadEarlier()}
            className="flex w-full cursor-pointer items-center gap-3 py-1.5 text-muted-foreground text-xs hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
          >
            <span aria-hidden="true" className="h-px flex-1 bg-border/70" />
            <span className="shrink-0">
              {props.loading ? gt("Loading earlier turns…") : gt("Load earlier turns")}
            </span>
            <span aria-hidden="true" className="h-px flex-1 bg-border/70" />
          </button>
        ) : null}
        {props.error !== null ? (
          <p role="status" className="text-center text-muted-foreground text-xs">
            {threadErrorText(props.error, messages)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function isMessageRow(row: MessagesTimelineRow) {
  return row.kind === "message" && row.message.role !== "system";
}

// LegendList recycles a row's container once it leaves the draw buffer, which
// moves a native selection's ends onto other rows. Pin the selected rows.
function useSelectedTimelineRowIds(viewport: HTMLElement | null) {
  const [rowIds, setRowIds] = useState<ReadonlyArray<string>>([]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to document selectionchange to track which timeline rows a native selection covers
  useEffect(() => {
    if (!viewport) return;
    const update = () => {
      const selection = document.getSelection();
      const range =
        selection && !selection.isCollapsed && selection.rangeCount > 0
          ? selection.getRangeAt(0)
          : null;
      const next: string[] = [];
      if (range?.intersectsNode(viewport)) {
        for (const row of viewport.querySelectorAll<HTMLElement>("[data-timeline-row-id]")) {
          const rowId = row.dataset.timelineRowId;
          if (rowId && range.intersectsNode(row)) next.push(rowId);
        }
      }
      setRowIds((current) =>
        current.length === next.length && current.every((id, i) => id === next[i]) ? current : next,
      );
    };
    document.addEventListener("selectionchange", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      setRowIds([]);
    };
  }, [viewport]);
  return rowIds;
}

// Rows between the selected ones are covered too, even if not mounted right now.
function timelineRowSpanIndices(
  rows: ReadonlyArray<MessagesTimelineRow>,
  rowIds: ReadonlyArray<string>,
): number[] {
  if (rowIds.length === 0) return [];
  const selected = new Set(rowIds);
  const first = rows.findIndex((row) => selected.has(row.id));
  const last = rows.findLastIndex((row) => selected.has(row.id));
  if (first < 0) return [];
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

function keyExtractor(item: MessagesTimelineRow) {
  return item.id;
}

// LegendList estimates unmeasured rows from their type's average. Long messages of equal length
// can differ in height by orders of magnitude, so each gets its own type to avoid nested-update loops.
function getItemType(item: MessagesTimelineRow) {
  if (item.kind !== "message") return item.kind;
  const lengthBucket = Math.max(0, Math.floor(Math.log2(item.message.text.length / 1000)));
  return lengthBucket < 2
    ? `message:${item.message.role}:${lengthBucket}`
    : `message:${item.message.id}`;
}

const TimelineRowContent = memo(function TimelineRowContent({ row }: { row: TimelineRow }) {
  const isExpandedToolGroup = row.kind === "work" && row.isExpandedToolGroup;
  const isSubagentGroup = row.kind === "event" && row.projectedItem.item.type === "subagent";
  const isWorkLogRow =
    row.kind === "work" ||
    row.kind === "work-live" ||
    row.kind === "work-toggle" ||
    row.kind === "thinking";
  const isExpandedToolGroupHeader =
    (row.kind === "work-toggle" || row.kind === "work-live" || row.kind === "thinking") &&
    row.expanded === true;

  const arrival = use(ChatArrivalContext);
  const arrivalProps = useChatArrivalProps(arrival, row.kind === "message" ? row.id : null);
  const followUp = use(ChatFollowUpContext);
  const stage = use(ChatStageContext);
  const handoffAnswerId = use(ChatHandoffAnswerContext);
  // Chat mode lifts a turn's notices out of its activity rows into one quiet line.
  const noticePlan = use(ChatNoticePlanContext).get(row.id);
  const workEntries =
    row.kind === "work" && noticePlan !== undefined
      ? row.groupedEntries.filter((entry) => !isNoticeEntry(entry))
      : row.kind === "work"
        ? row.groupedEntries
        : null;
  const showsWorkLog = isWorkLogRow && (row.kind !== "work" || (workEntries?.length ?? 0) > 0);
  return (
    <div
      {...arrivalProps}
      // The first answer after the stage cross-fades with its picture; the working line follows.
      data-chat-handoff={
        stage !== null &&
        !stage.active &&
        (row.kind === "working" || (row.kind === "message" && row.id === handoffAnswerId))
          ? ""
          : undefined
      }
      className={cn(
        isWorkLogRow || isSubagentGroup
          ? undefined
          : row.kind === "turn-fold" || row.kind === "working"
            ? "pb-1.5"
            : row.kind === "message" && row.groupedWithNext
              ? "pb-1"
              : (row.kind === "message" &&
                    row.message.role === "assistant" &&
                    !row.showAssistantMeta) ||
                  row.kind === "worktree-setup" ||
                  row.kind === "event" ||
                  row.kind === "attempt-fold" ||
                  row.kind === "html-render" ||
                  row.kind === "sent-message" ||
                  row.kind === "mcp-app" ||
                  row.kind === "viewed-images"
                ? "pb-2"
                : "pb-4",
        (row.kind === "message" && row.message.role === "assistant") ||
          row.kind === "assistant-meta"
          ? "group/assistant"
          : null,
      )}
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={
        row.kind === "message" || row.kind === "assistant-meta" ? row.message.id : undefined
      }
      data-message-role={row.kind === "message" ? row.message.role : undefined}
      data-one-after={row.kind === "message" && row.afterLongAnswer ? "long" : undefined}
    >
      {showsWorkLog ? (
        <WorkLogBlock
          continues={row.continuesWorkLog}
          layout={
            isExpandedToolGroup
              ? "group-content"
              : isExpandedToolGroupHeader
                ? "group-header"
                : "standalone"
          }
        >
          {row.kind === "work" ? (
            <WorkGroupSection
              anchorKey={row.id}
              groupedEntries={workEntries ?? row.groupedEntries}
              isExpandedToolGroup={row.isExpandedToolGroup}
              displayLabel={row.displayLabel}
            />
          ) : null}
          {row.kind === "work-live" ? <LiveWorkEntryTimelineRow row={row} /> : null}
          {row.kind === "work-toggle" ? <WorkGroupToggleTimelineRow row={row} /> : null}
          {row.kind === "thinking" ? <ThinkingTimelineRow row={row} /> : null}
        </WorkLogBlock>
      ) : null}
      {noticePlan !== undefined ? <ChatNoticeLine plan={noticePlan} /> : null}
      {row.kind === "turn-fold" ? <TurnFoldTimelineRow key={row.id} row={row} /> : null}
      {row.kind === "attempt-fold" ? <AttemptFoldTimelineRow row={row} /> : null}
      {row.kind === "context-compaction" ? <ContextCompactionTimelineRow row={row} /> : null}
      {row.kind === "message" && row.message.role === "user" ? <UserMessageRow row={row} /> : null}
      {row.kind === "message" && row.message.role === "assistant" ? (
        <ChatQuizMessageContext value={row.message.id}>
          <AssistantTimelineRow row={row} />
        </ChatQuizMessageContext>
      ) : null}
      {row.kind === "assistant-meta" ? <AssistantMetaTimelineRow row={row} /> : null}
      {row.kind === "proposed-plan" ? <ProposedPlanTimelineRow row={row} /> : null}
      {row.kind === "html-render" ? <HtmlRenderTimelineRow row={row} /> : null}
      {row.kind === "sent-message" ? <SentMessageTimelineRow row={row} /> : null}
      {row.kind === "viewed-images" ? <ViewedImagesTimelineRow row={row} /> : null}
      {row.kind === "mcp-app" ? <McpAppTimelineRow row={row} /> : null}
      {row.kind === "working" ? <WorkingStatusRow row={row} /> : null}
      {row.kind === "worktree-setup" ? <WorktreeSetupTimelineRow row={row} /> : null}
      {row.kind === "event" ? <V2EventTimelineRow row={row} /> : null}
      {stage !== null && stage.userRowId === row.id ? <ChatStageBlock stage={stage} /> : null}
      {followUp.rowId === row.id && followUp.composerRef !== null ? (
        <ChatFollowUps ready={followUp.ready} composer={followUp.composerRef} />
      ) : null}
    </div>
  );
});

/** Chat mode says "Waiting for you" while a request needs the person; the working line otherwise. */
function WorkingStatusRow({ row }: { row: Extract<TimelineRow, { kind: "working" }> }) {
  const { awaitingUser, isCompacting, isPreparingWorktree } = use(TimelineRowActivityCtx);
  const chatMode = useWorkspaceMode() === "chat";
  const stage = use(ChatStageContext);
  // The waiting stage has its own arc and timer.
  if (chatMode && stage?.active === true) return null;
  return chatMode && awaitingUser && !row.compacting && !isCompacting && !isPreparingWorktree ? (
    <ChatWaitingLine since={row.createdAt} />
  ) : (
    <WorkingTimelineRow row={row} />
  );
}

function WorktreeSetupTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "worktree-setup" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const chatMode = useWorkspaceMode() === "chat";
  // Chat mode keeps preparation behind the header's status dot, and shows only what went wrong.
  const needsLook =
    row.snapshot.phase === "failed" ||
    (row.snapshot.phase === "done" &&
      row.snapshot.stages.some((stage) => stage.status === "failed"));
  if (chatMode && !needsLook) return null;
  const terminalId = row.snapshot.setupScript?.terminalId ?? null;
  const openTerminal = ctx.onOpenWorktreeSetupTerminal;
  const onOpenTerminal = openTerminal && terminalId ? () => openTerminal(terminalId) : null;
  return (
    <WorktreeSetupCard
      snapshot={row.snapshot}
      embedded={row.embedded}
      onCancel={row.embedded ? null : ctx.onCancelWorktreeSetup}
      onWorkLocally={
        !row.embedded && row.snapshot.phase === "running" ? ctx.onWorktreeSetupWorkLocally : null
      }
      onOpenTerminal={onOpenTerminal}
    />
  );
}

function ContextCompactionTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "context-compaction" }>;
}) {
  const gt = useGT();
  const label =
    row.title && row.compacted
      ? row.tokenCounts
        ? gt("{title} {before} → {after} tokens", { title: row.title, ...row.tokenCounts })
        : row.title
      : row.label;
  const content = (
    <span className="flex min-w-0 items-center gap-1.5">
      {row.failed ? (
        <CircleAlertIcon aria-hidden="true" className="size-3 shrink-0" />
      ) : (
        <Minimize2Icon aria-hidden="true" className="size-3" />
      )}
      {row.tokenCounts ? (
        <>
          {row.title ? (
            <T>
              <Var>{row.title}</Var> <Var>{row.tokenCounts.before}</Var>
              <ArrowRightIcon aria-hidden="true" className="size-3" />
              <Var>{row.tokenCounts.after}</Var> tokens
            </T>
          ) : (
            <T>
              Context compacted <Var>{row.tokenCounts.before}</Var>
              <ArrowRightIcon aria-hidden="true" className="size-3" />
              <Var>{row.tokenCounts.after}</Var> tokens
            </T>
          )}
        </>
      ) : (
        label
      )}
      {row.failure ? (
        // oxlint-disable-next-line t3code/no-untranslated-copy -- separator before server-authored failure text
        <span className="min-w-0 truncate opacity-80">&middot; {row.failure}</span>
      ) : null}
    </span>
  );
  return (
    <div
      role="separator"
      aria-label={row.failure ? `${label}: ${row.failure}` : label}
      className={cn(
        "mx-auto flex w-full max-w-(--chat-content-max-width) items-center gap-3 py-1 text-xs",
        row.failed ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <span className={cn("h-px flex-1", row.failed ? "bg-destructive/30" : "bg-border/70")} />
      <span
        ref={row.active ? observeVisibleAnimation : undefined}
        className="one-shimmer-host relative min-w-0 overflow-hidden"
      >
        {content}
        {row.active ? <ActivityShimmerOverlay>{content}</ActivityShimmerOverlay> : null}
      </span>
      <span className={cn("h-px flex-1", row.failed ? "bg-destructive/30" : "bg-border/70")} />
    </div>
  );
}

function useDeferredWorkLoading(
  row: { expanded: boolean; deferredWorkItemIds?: ReadonlyArray<string> },
  onToggle: () => void,
) {
  const gt = useGT();
  const ctx = use(TimelineRowCtx);
  const loadWork = useAtomCommand(threadEnvironment.loadEarlierHistory, { reportFailure: false });
  const ref = parseScopedThreadKey(ctx.routeThreadKey);
  const environmentId = ref?.environmentId;
  const threadId = ref?.threadId;
  const anchorsKey = row.deferredWorkItemIds?.join("\n") ?? "";
  const [failed, setFailed] = useState(false);
  const load = () => {
    if (!anchorsKey || environmentId === undefined || threadId === undefined) return;
    void Promise.all(
      anchorsKey
        .split("\n")
        .map((workAnchorId) => loadWork({ environmentId, input: { threadId, workAnchorId } })),
    ).then((results) =>
      setFailed(
        results.some((result) => result._tag === "Failure" || result.value._tag === "error"),
      ),
    );
  };
  const loadOnExpand = useEffectEvent(load);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Restored expanded folds load their deferred server history on mount.
  useEffect(() => {
    if (row.expanded && anchorsKey && environmentId && threadId) loadOnExpand();
  }, [row.expanded, anchorsKey, environmentId, threadId]);
  const error = anchorsKey && failed ? gt("Couldn't load work. Click to retry.") : null;
  const loading = ref !== null && row.expanded && anchorsKey !== "" && !failed;
  const toggle = () => {
    setFailed(false);
    if (error && row.expanded) load();
    else onToggle();
  };

  return { loading, error, toggle };
}

function WorkHistorySkeleton() {
  const gt = useGT();
  return (
    <div role="status" aria-label={gt("Loading work history")} className="space-y-2 px-1 pb-1 pt-3">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center gap-2" aria-hidden="true">
          <Skeleton className="size-3 shrink-0" />
          <Skeleton
            shape="pill"
            className={index === 0 ? "h-2.5 w-2/5" : index === 1 ? "h-2.5 w-3/5" : "h-2.5 w-1/3"}
          />
        </div>
      ))}
    </div>
  );
}

function TurnFoldTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "turn-fold" }> }) {
  const ctx = use(TimelineRowCtx);
  const { loading, error, toggle } = useDeferredWorkLoading(row, () =>
    ctx.onToggleTurnFold(row.runId),
  );
  const m = useMessages();
  const label = useWorkspaceMode() === "chat" ? chatFoldLabel(row, m) : row.label;

  return (
    <div
      className="group/timeline-row border-b border-border/60 pb-2 pe-0.5 pt-1"
      data-one-turn-start={row.startsTurn ? "" : undefined}
      data-one-fold={row.quiet ? "quiet" : undefined}
    >
      <div className="relative flex items-center gap-1">
        <button
          type="button"
          aria-expanded={row.expanded}
          data-scroll-anchor-ignore
          onClick={toggle}
          aria-busy={loading}
          className="flex cursor-pointer select-none items-center gap-1 rounded-md px-1 text-sm leading-relaxed text-muted-foreground tabular-nums transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        >
          <span>
            {label}
            {error ? ` · ${error}` : ""}
          </span>
          {row.expanded ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
        </button>
        <TimelineRowTimestamp
          createdAt={row.createdAt}
          timestampFormat={ctx.timestampFormat}
          className="ms-auto"
        />
      </div>
      {loading ? <WorkHistorySkeleton /> : null}
    </div>
  );
}

function AttemptFoldTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "attempt-fold" }> }) {
  const ctx = use(TimelineRowCtx);
  const { loading, error, toggle } = useDeferredWorkLoading(row, () =>
    ctx.onToggleAttemptFold(row.attemptId),
  );

  return (
    <div>
      <button
        type="button"
        aria-expanded={row.expanded}
        data-scroll-anchor-ignore
        data-superseded-attempt-id={row.attemptId}
        onClick={toggle}
        aria-busy={loading}
        className="flex w-full cursor-pointer select-none items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        {row.expanded ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs font-medium text-foreground/80">
          {row.label}
          {error ? ` · ${error}` : ""}
        </span>
        <span className="text-2xs text-muted-foreground">
          <T>Cut off by a steer</T>
        </span>
      </button>
      {loading ? <WorkHistorySkeleton /> : null}
    </div>
  );
}
