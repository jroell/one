import type { PullRequestListEntry, PullRequestSummary, ScopedThreadRef } from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  PanelRightIcon,
  TagIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  sourceControlClients,
  type ChangeRequestTerminology,
} from "@t3tools/client-runtime/source-control-clients";

import { useOpenLink } from "~/browser/useOpenLink";
import { cn } from "~/lib/utils";
import { RelativeTime } from "~/components/RelativeTime";

import { Button, InlineButton } from "../ui/button";
import { MiddleTruncate } from "../ui/middle-truncate";
import { PULL_REQUEST_ROW_CLASS } from "./PullRequestListRow";
import { PullRequestCopyableCode } from "./PullRequestCopyableCode";
import {
  PullRequestChecksStatusLine,
  PullRequestDetailHeaderBody,
  PullRequestDetailTabBar,
  PullRequestDetailTitleRow,
} from "./PullRequestDetailLayout";
import {
  PullRequestActorLabel,
  PullRequestDiffStat,
  PullRequestLabelChip,
  pullRequestChecksStatePresentation,
  resolvePullRequestState,
} from "./pullRequestPresentation";
import { resolveFilterOptions } from "./pullRequestListOptions";

import { changeRequestTermKind } from "./changeRequestTerm";

export function GhostBar({ className }: { className?: string | undefined }) {
  return <span aria-hidden className={cn("block h-3 rounded bg-muted-foreground/15", className)} />;
}

const TITLE_WIDTHS = ["w-3/5", "w-2/5", "w-1/2", "w-2/3", "w-2/5", "w-3/5", "w-1/2"];
const META_WIDTHS = ["w-2/5", "w-1/3", "w-2/5", "w-1/4", "w-1/3", "w-2/5", "w-1/3"];
const DEFAULT_DETAIL_TABS = [
  { value: "summary", label: msg("Summary", { $context: "pull request tab" }) },
  { value: "timeline", label: msg("Timeline", { $context: "pull request tab" }) },
  { value: "code", label: msg("Code", { $context: "pull request tab" }) },
] as const;

/** One placeholder row, laid out like a loaded list row so nothing moves when data arrives. */
function PullRequestListGhostRow({ index }: { index: number }) {
  return (
    <div data-one-row="" data-one-ghost-row="" className="flex items-center">
      <div data-one-ghost-row-body="" className={cn(PULL_REQUEST_ROW_CLASS, "px-3.5 py-2.5")}>
        <span className="flex w-4 shrink-0 flex-col items-center self-start">
          <GhostBar className="mt-0.75 size-4 rounded-full" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <GhostBar className="h-3.5 w-9 shrink-0" />
            <GhostBar
              className={cn("h-3.5 max-w-full", TITLE_WIDTHS[index % TITLE_WIDTHS.length])}
            />
            <GhostBar className="ml-auto h-3.5 w-12 shrink-0" />
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5">
            <GhostBar className="size-3.5 shrink-0 rounded-full" />
            <GhostBar className={cn("h-3 max-w-full", META_WIDTHS[index % META_WIDTHS.length])} />
            <GhostBar className="h-3 w-14 shrink-0 rounded-full" />
            <GhostBar className="ml-auto h-3 w-10 shrink-0" />
          </span>
        </span>
      </div>
    </div>
  );
}

/** A list that is still empty after this long is slow, not about to arrive: say so. */
const SLOW_LIST_MS = 8000;

function useElapsed(afterMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- timer that flips once when a load has run long
  useEffect(() => {
    const timer = window.setTimeout(() => setElapsed(true), afterMs);
    return () => window.clearTimeout(timer);
  }, [afterMs]);
  return elapsed;
}

export function PullRequestListGhost({
  rows = 7,
  caption,
  slowCaption,
  onRetry,
}: {
  rows?: number;
  caption?: string;
  /** Replaces the caption once the load has run long, with Retry when `onRetry` is given. */
  slowCaption?: string;
  onRetry?: () => void;
}) {
  const gt = useGT();
  const slow = useElapsed(SLOW_LIST_MS) && slowCaption !== undefined;
  return (
    <div
      role="status"
      aria-label={caption ?? gt("Loading pull requests")}
      data-one-panel=""
      data-one-ghost=""
    >
      <div data-one-panel-head="" className="flex items-center gap-2 text-xs font-medium">
        <GhostBar className="h-3 w-16" />
        {/* The caption fades in only if the load is slow; a fast load never shows it. */}
        {caption ? (
          <span data-one-ghost-caption="" {...(slow ? { "data-slow": "" } : {})}>
            {slow ? slowCaption : caption}
          </span>
        ) : null}
        {slow && onRetry ? (
          <Button size="xs" variant="outline" className="ml-auto" onClick={onRetry}>
            <T>Retry</T>
          </Button>
        ) : null}
      </div>
      <div className="motion-safe:animate-skeleton">
        {Array.from({ length: rows }, (_, index) => (
          <PullRequestListGhostRow key={index} index={index} />
        ))}
      </div>
    </div>
  );
}

export function PullRequestDetailGhost({
  seed: entry,
  summary,
  actions,
  checkoutCommand,
  tabs: requestedTabs,
  activeTab,
  number,
  onBack,
  onClose,
  onCheckoutError,
  threadRef = null,
}: {
  seed?: PullRequestListEntry | null;
  summary?: PullRequestSummary | null;
  actions?: ReactNode;
  checkoutCommand?: string | null;
  tabs?: ReadonlyArray<{ value: string; label: string }>;
  activeTab?: string;
  number?: number;
  onBack?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  onCheckoutError?: ((error: Error) => void) | undefined;
  threadRef?: ScopedThreadRef | null | undefined;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const openLink = useOpenLink(threadRef);
  const tabs = requestedTabs ?? resolveFilterOptions(DEFAULT_DETAIL_TABS, resolve);
  const seed = summary
    ? {
        ...entry,
        ...summary,
        isDraft: summary.isDraft ?? entry?.isDraft,
      }
    : entry;
  const terminology = sourceControlClients.get(seed?.provider).changeRequest;
  const statePresentation = seed
    ? resolvePullRequestState(
        {
          state: seed.state,
          isDraft: seed.isDraft ?? false,
        },
        resolve,
      )
    : null;
  // Passing list rollups can omit workflows awaiting approval; wait for detail.
  const checksPresentation =
    seed?.checksState === "failing" || seed?.checksState === "pending"
      ? pullRequestChecksStatePresentation(seed.checksState, resolve)
      : null;
  const checkout = checkoutCommand ?? null;
  const changedFiles = summary?.changedFiles ?? null;
  const selectedTab =
    tabs.find((item) => item.value === activeTab)?.value ?? tabs[0]?.value ?? "summary";

  return (
    <div
      role="status"
      aria-label={gt(
        "Loading {term, select, mr {merge request} cr {change request} other {pull request}}",
        { term: changeRequestTermKind(terminology) },
      )}
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-background",
        !seed && "motion-safe:animate-skeleton",
      )}
    >
      <div className="@container/pr-header grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 border-b border-border/60">
        <div className="pl-4 grid h-7 min-w-0 items-center overflow-hidden">
          <div className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground sm:text-xs">
            {onBack ? (
              <Button
                size="icon-micro"
                variant="ghost-muted"
                className="-ml-1.5"
                onClick={onBack}
                aria-label={gt("Back to this thread's pull requests")}
              >
                <ArrowLeftIcon aria-hidden className="size-3.5" />
              </Button>
            ) : null}
            {seed ? (
              <>
                <span className="min-w-0 truncate font-medium">{seed.repository}</span>
                <InlineButton
                  onClick={(event) => void openLink(seed.url, { event }).catch(console.error)}
                  onAuxClick={(event) => {
                    if (event.button === 1) void openLink(seed.url, { event }).catch(console.error);
                  }}
                  aria-label={gt(
                    "Open {term, select, mr {merge request} cr {change request} other {pull request}} #{number} on host",
                    {
                      term: changeRequestTermKind(terminology),
                      number: seed.number,
                    },
                  )}
                >
                  <span className={statePresentation?.toneClassName}>#{seed.number}</span>
                  <ExternalLinkIcon aria-hidden className="size-2.5" />
                </InlineButton>
              </>
            ) : (
              <>
                <GhostBar className="w-24" />
                <span className="shrink-0 text-xs text-muted-foreground">#{number ?? "…"}</span>
              </>
            )}
          </div>
        </div>
        <div className="mr-4 flex h-7 shrink-0 items-center justify-end gap-1">
          {actions ?? <GhostBar className="h-6 w-16 rounded-md" />}
          <Button
            size="icon-xs"
            variant="ghost"
            disabled
            aria-label={gt(
              "{term, select, mr {Merge request} cr {Change request} other {Pull request}} actions loading",
              {
                term: changeRequestTermKind(terminology),
              },
            )}
          >
            <EllipsisIcon aria-hidden className="size-4" />
          </Button>
          {onClose ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={gt(
                "Collapse {term, select, mr {merge request} cr {change request} other {pull request}} panel",
                { term: changeRequestTermKind(terminology) },
              )}
              onClick={onClose}
            >
              <PanelRightIcon aria-hidden className="size-3.5" />
            </Button>
          ) : null}
        </div>

        <div className="col-span-2 grid grid-rows-[1fr]">
          <div className="min-h-0 overflow-hidden">
            <PullRequestDetailHeaderBody
              title={
                <PullRequestDetailTitleRow>
                  {seed ? (
                    <h1 className="truncate text-base font-semibold leading-snug">{seed.title}</h1>
                  ) : (
                    <GhostBar className="h-5 w-4/5 max-w-md" />
                  )}
                </PullRequestDetailTitleRow>
              }
              author={
                seed ? (
                  <PullRequestActorLabel actor={seed.author ?? null} tooltip={false} />
                ) : (
                  <span className="flex items-center gap-1.5">
                    <GhostBar className="size-4 rounded-full" />
                    <GhostBar className="h-3 w-14" />
                  </span>
                )
              }
              updated={
                seed ? (
                  <span>
                    <T context="followed by a relative time such as 5m ago or just now">
                      updated{" "}
                      <Var>
                        <RelativeTime timestamp={seed.updatedAt} />
                      </Var>
                    </T>
                  </span>
                ) : (
                  <GhostBar className="h-3 w-16" />
                )
              }
              checkout={
                checkout ? (
                  <PullRequestCopyableCode
                    key={checkout}
                    value={checkout}
                    target={{
                      target: `${terminology.singular} checkout command`,
                      unavailableMessage: msg(
                        "Clipboard API is unavailable while copying {term, select, mr {merge request} cr {change request} other {pull request}} checkout command.",
                        { term: changeRequestTermKind(terminology) },
                      ),
                      failureMessage: msg(
                        "Failed to copy {term, select, mr {merge request} cr {change request} other {pull request}} checkout command to the clipboard.",
                        { term: changeRequestTermKind(terminology) },
                      ),
                    }}
                    copyLabel={gt("Copy checkout command")}
                    copiedLabel={gt("Checkout command copied")}
                    className="ml-auto font-mono"
                    tooltipSide="bottom"
                    {...(onCheckoutError ? { onError: onCheckoutError } : {})}
                  />
                ) : null
              }
              base={
                <span className="inline-flex min-w-0 max-w-[40%] shrink-0 items-center gap-1">
                  {seed ? (
                    <code className="flex min-w-0">
                      <MiddleTruncate value={seed.baseBranch} />
                    </code>
                  ) : (
                    <GhostBar className="h-3 w-12" />
                  )}
                </span>
              }
              head={
                seed ? (
                  <PullRequestCopyableCode
                    key={seed.headBranch}
                    value={seed.headBranch}
                    target={{
                      target: "branch name",
                      unavailableMessage: msg(
                        "Clipboard API is unavailable while copying branch name.",
                      ),
                      failureMessage: msg("Failed to copy branch name to the clipboard."),
                    }}
                    copyLabel={gt(
                      "Copy {term, select, mr {merge request} cr {change request} other {pull request}} branch",
                      { term: changeRequestTermKind(terminology) },
                    )}
                    copiedLabel={gt("Branch name copied")}
                    className="min-w-0 font-mono"
                  />
                ) : (
                  <GhostBar className="h-3 w-32 flex-1" />
                )
              }
              files={
                changedFiles === null ? (
                  <GhostBar className="h-3 w-10" />
                ) : (
                  gt("{count, plural, one {{formatted} file} other {{formatted} files}}", {
                    count: changedFiles,
                    formatted: changedFiles.toLocaleString(),
                  })
                )
              }
              diffStat={
                seed ? (
                  <PullRequestDiffStat
                    additions={seed.additions ?? 0}
                    deletions={seed.deletions ?? 0}
                    className="shrink-0 font-mono text-xs"
                  />
                ) : (
                  <GhostBar className="h-3 w-20" />
                )
              }
            />
          </div>
        </div>

        <PullRequestDetailTabBar tabs={tabs} value={selectedTab} inert>
          {checksPresentation ? (
            <PullRequestChecksStatusLine
              className={checksPresentation.toneClassName}
              icon={<checksPresentation.Icon aria-hidden className="size-3.5" />}
              label={checksPresentation.label}
            />
          ) : (
            <PullRequestChecksStatusLine
              icon={<GhostBar className="my-px size-3.5 rounded-full" />}
              label={<GhostBar className="w-28" />}
            />
          )}
        </PullRequestDetailTabBar>
      </div>

      <div
        tabIndex={-1}
        data-workspace-focus-default
        className="min-h-0 flex-1 overflow-hidden outline-none"
      >
        <section className="px-4 pt-2.5 pb-1">
          <div className="space-y-2">
            <div className="grid min-h-7 min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 text-xs sm:min-h-6">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <UsersIcon aria-hidden className="size-3.5" />
                <T>Reviewers</T>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                <GhostBar className="h-3 w-10" />
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled
                  aria-label={gt("Reviewers loading")}
                >
                  <UserPlusIcon aria-hidden className="size-3.5" />
                </Button>
              </span>
            </div>
            <div className="grid min-h-7 min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 text-xs sm:min-h-6">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <TagIcon aria-hidden className="size-3.5" />
                <T>Labels</T>
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-1 text-foreground">
                {entry?.labels ? (
                  entry.labels.length > 0 ? (
                    entry.labels.map((label) => (
                      <PullRequestLabelChip
                        key={label.name}
                        label={label}
                        size="default"
                        className="max-w-48"
                      />
                    ))
                  ) : (
                    <span className="text-muted-foreground">
                      <T context="no labels">None</T>
                    </span>
                  )
                ) : (
                  <>
                    <GhostBar className="h-4.5 w-24" />
                    <GhostBar className="h-4.5 w-20" />
                  </>
                )}
                <Button size="icon-xs" variant="ghost" disabled aria-label={gt("Labels loading")}>
                  <TagIcon aria-hidden className="size-3.5" />
                </Button>
              </span>
            </div>
          </div>
        </section>

        <section>
          <div className="sticky top-0 z-10 flex w-full items-center bg-background pr-4">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 px-4 py-3 text-left text-xs font-medium text-muted-foreground">
              <span>
                <T>Description</T>
              </span>
              <ChevronRightIcon
                aria-hidden
                className="size-3.5 rotate-90 text-muted-foreground/60"
              />
            </div>
          </div>
          <div className="space-y-3 px-4 pb-4">
            <GhostBar className="h-5 w-40" />
            <div className="space-y-2">
              <GhostBar className="h-4 w-full" />
              <GhostBar className="h-4 w-11/12" />
              <GhostBar className="h-4 w-4/5" />
              <GhostBar className="h-4 w-2/3" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function PullRequestPeopleGhost({ rows = 4 }: { rows?: number }) {
  const gt = useGT();
  return (
    <div
      role="status"
      aria-label={gt("Loading people")}
      className="motion-safe:animate-skeleton space-y-1 p-1"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-7 items-center gap-2 rounded-md px-2">
          <GhostBar className="size-4 rounded-full" />
          <GhostBar className={META_WIDTHS[index % META_WIDTHS.length]} />
        </div>
      ))}
    </div>
  );
}

export function PullRequestTimelineGhost({ rows = 6 }: { rows?: number }) {
  const gt = useGT();
  return (
    <div
      role="status"
      aria-label={gt("Loading timeline")}
      className="motion-safe:animate-skeleton px-4 py-5"
    >
      <div className="relative ml-2 border-l border-border/70 pl-5">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="relative pb-5">
            <GhostBar className="absolute -left-[1.55rem] top-1 size-2 rounded-full" />
            <GhostBar className={cn("h-3.5", TITLE_WIDTHS[index % TITLE_WIDTHS.length])} />
            <GhostBar className="mt-1.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PullRequestConversationGhost({
  rows = 3,
  terminology,
}: {
  rows?: number;
  terminology: ChangeRequestTerminology;
}) {
  const gt = useGT();
  return (
    <div
      role="status"
      aria-label={gt(
        "Loading {term, select, mr {merge request} cr {change request} other {pull request}} conversation",
        { term: changeRequestTermKind(terminology) },
      )}
      className="motion-safe:animate-skeleton space-y-4 py-2"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-start gap-2">
          <GhostBar className="size-5 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <GhostBar className={META_WIDTHS[index % META_WIDTHS.length]} />
            <GhostBar className="w-full" />
            <GhostBar className="w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
