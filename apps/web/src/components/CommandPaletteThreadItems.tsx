import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { findForMessageMatch, openThreadFindOnQuery } from "./chat/threadFindStore";
import {
  claimThreadOpen,
  nextShownOrder,
  type EnvironmentThreadSearchMatch,
  type ShownOrder,
} from "@t3tools/client-runtime/state/thread-search";
import {
  foldSearchQuery,
  PALETTE_MESSAGE_LIMIT,
  pickedQuery,
  rankMessageMatches,
} from "@t3tools/shared/paletteSearch";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";
import { useInsertionEffect, useState } from "react";
import { useLocale } from "gt-react";
import { useStableCallback } from "../hooks/useStableCallback";
import { useStableGT, useStableMessages } from "../hooks/useStableTranslation";

import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../providerInstances";
import { useDelegatedUnderParent, useVisibleThreadShells } from "../state/entities";
import {
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../state/environments";
import { useThreadSearch } from "../state/queries";
import { primaryServerProvidersAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { formatRelativeTimeLabel } from "../timestampFormat";
import {
  buildThreadActionItems,
  cachedThreadActionItems,
  ITEM_ICON_CLASS,
} from "./CommandPalette.logic";
import { useEnvironmentLookups, useProjectLookups } from "./CommandPaletteLookups";
import { ThreadCommandSubtitle } from "./ThreadCommandSubtitle";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { ThreadRowLeadingStatus, ThreadRowTrailingStatus } from "./ThreadStatusIndicators";
import { PaletteThreadPullRequestNumber } from "./commandPalette/paletteQuery";

function useProviderEntryByEnvironmentAndInstanceId() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const providersByEnvironment = useEnvironmentProviders();
  return new Map<string, ProviderInstanceEntry>(
    environments.flatMap((environment) => {
      const serverConfig = environment.serverConfig;
      const derived = deriveProviderInstanceEntries(
        providersByEnvironment.get(environment.environmentId) ??
          (environment.environmentId === primaryEnvironmentId ? providers : []),
      );
      const entries = serverConfig
        ? applyProviderInstanceSettings(derived, serverConfig.settings, null)
        : derived;
      return entries.map(
        (entry) => [`${environment.environmentId}:${entry.instanceId}`, entry] as const,
      );
    }),
  );
}

function useConnectedThreadSearch(query: string) {
  const { environments } = useEnvironments();
  const { projectEnvironmentLocationById } = useEnvironmentLookups();
  const environmentIds: ReadonlyArray<EnvironmentId> = environments
    .filter((environment) => environment.connection.phase === "connected")
    .map((environment) => environment.environmentId);
  // The palette matches environment names when there are several; older rows must match the same.
  const environmentLabels =
    environments.length > 1
      ? Object.fromEntries(
          environmentIds.flatMap((environmentId) => {
            const label = projectEnvironmentLocationById.get(environmentId)?.label;
            return label === undefined || label === null ? [] : [[environmentId, label]];
          }),
        )
      : undefined;
  return useThreadSearch(
    environmentIds,
    query,
    environmentLabels === undefined ? {} : { environmentLabels },
  );
}

/**
 * Every visible thread as a palette item, plus, for a non-empty
 * `threadSearchQuery`, the threads whose messages match, best first.
 */
/** Which project, machine, branch and worktree a thread is in, by identity rather than by label. */
function threadContextKey(thread: {
  environmentId: string;
  projectId: string;
  branch: string | null;
  worktreePath: string | null;
}): string {
  return [
    thread.environmentId,
    thread.projectId,
    thread.branch ?? "",
    thread.worktreePath ?? "",
  ].join("\u0000");
}

type ThreadShell = ReturnType<typeof useVisibleThreadShells>[number];

// Set by the palette that is open; see `useCommandPaletteThreadItems`.
let liveRunThread: (thread: ThreadShell) => Promise<void> = async () => undefined;

export function useCommandPaletteThreadItems(input: {
  readonly activeThread: { readonly environmentId: EnvironmentId; readonly id: ThreadId } | null;
  readonly threadSearchQuery: string;
}) {
  const { activeThread, threadSearchQuery } = input;
  const messages = useStableMessages();
  const gt = useStableGT();
  const locale = useLocale();
  const navigate = useNavigate();
  const threads = useVisibleThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const { projectEnvironmentLocationById } = useEnvironmentLookups();
  const providerEntryByEnvironmentAndInstanceId = useProviderEntryByEnvironmentAndInstanceId();
  const messageSearch = useConnectedThreadSearch(threadSearchQuery);
  const { projectByKey } = useProjectLookups();
  const visitThread = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  // Ranking is relative to when the palette opened, so rows do not reorder as time passes.
  const [now] = useState(() => Date.now());

  // Items are built once and kept while the person types, so a pick reads the latest query when it
  // runs, not when the item was built.
  const runThreadNow = useStableCallback(async (thread: (typeof threads)[number]) => {
    // A pick sends its open with the query, always, so the server records
    // it; the thread view then skips its own open. The open thread is no pick.
    const isOpen =
      activeThread?.environmentId === thread.environmentId && activeThread.id === thread.id;
    if (threadSearchQuery.trim().length > 0 && !threadSearchQuery.startsWith(">") && !isOpen) {
      claimThreadOpen(thread.environmentId, thread.id, Date.now());
    }
    if (
      threadSearchQuery.trim().length > 0 &&
      !threadSearchQuery.startsWith(">") &&
      thread.lastVisitedAt !== undefined &&
      !isOpen
    ) {
      void visitThread({
        environmentId: thread.environmentId,
        input: {
          threadId: thread.id,
          visitedAt: thread.updatedAt,
          opened: true,
          searchQuery: pickedQuery(threadSearchQuery),
        },
      });
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  });

  // The items are cached across openings, so they call whichever opening is live, not the one
  // that built them.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- points the module-level pick handler of the cached items at the open palette
  useInsertionEffect(() => {
    liveRunThread = runThreadNow;
  });

  const { environments } = useEnvironments();
  const threadItems = cachedThreadActionItems(
    [
      threads,
      delegatedUnderParent,
      projectByKey,
      projectEnvironmentLocationById,
      providerEntryByEnvironmentAndInstanceId,
      environments,
      activeThread?.environmentId,
      activeThread?.id,
      locale,
    ],
    () =>
      buildThreadActionItems(
        {
          threads,
          delegatedUnderParent,
          locale,
          ...(environments.length > 1
            ? {
                environmentLabelOf: (thread: (typeof threads)[number]) =>
                  projectEnvironmentLocationById.get(thread.environmentId)?.label ?? null,
              }
            : {}),
          ...(activeThread ? { activeThread } : {}),
          projectByKey,
          icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
          renderLeadingContent: (thread) => <ThreadRowLeadingStatus thread={thread} />,
          renderTrailingContent: (thread) => (
            <>
              <PaletteThreadPullRequestNumber
                thread={thread}
                settled={thread.settledOverride === "settled"}
              />
              <ThreadRowTrailingStatus thread={thread} />
            </>
          ),
          contextOf: (thread, { projectTitle }) => ({
            key: threadContextKey(thread),
            label: [
              projectTitle,
              projectEnvironmentLocationById.get(thread.environmentId)?.label ??
                gt("Remote", { $context: "machine location" }),
              thread.branch,
            ]
              .filter(Boolean)
              .join(" · "),
          }),
          renderTitleSuffix: (thread) => {
            const modelInstanceId =
              thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
            const providerEntry =
              providerEntryByEnvironmentAndInstanceId.get(
                `${thread.environmentId}:${modelInstanceId}`,
              ) ?? null;
            if (providerEntry?.driverKind == null) return null;
            return (
              <ProviderInstanceIcon
                driverKind={providerEntry.driverKind}
                displayName={
                  thread.runtime?.providerName ?? providerEntry.displayName ?? modelInstanceId
                }
                acpRegistryAgentId={providerEntry.acpRegistryAgentId}
                acpRegistryIconUrl={providerEntry.acpRegistryIconUrl}
                iconClassName="size-3 shrink-0 text-muted-foreground opacity-80"
              />
            );
          },
          renderDescription: (thread, { projectTitle }) => {
            const modelInstanceId =
              thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
            const providerEntry =
              providerEntryByEnvironmentAndInstanceId.get(
                `${thread.environmentId}:${modelInstanceId}`,
              ) ?? null;
            return (
              <ThreadCommandSubtitle
                project={projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null}
                projectTitle={projectTitle ?? null}
                environmentLabel={
                  projectEnvironmentLocationById.get(thread.environmentId)?.label ??
                  gt("Remote", { $context: "machine location" })
                }
                branch={thread.branch}
                contextKey={threadContextKey(thread)}
                variant="favicon-workspace"
                worktreePath={thread.worktreePath}
                isCurrent={
                  thread.id === activeThread?.id &&
                  thread.environmentId === activeThread.environmentId
                }
                driverKind={providerEntry?.driverKind ?? null}
                providerDisplayName={
                  thread.runtime?.providerName ?? providerEntry?.displayName ?? modelInstanceId
                }
                acpRegistryAgentId={providerEntry?.acpRegistryAgentId}
                acpRegistryIconUrl={providerEntry?.acpRegistryIconUrl}
              />
            );
          },
          runThread: (thread) => liveRunThread(thread),
        },
        messages,
      ),
  );

  const itemByValue = new Map(threadItems.map((item) => [item.value, item]));
  const itemForMatch = (match: EnvironmentThreadSearchMatch) =>
    itemByValue.get(`thread:${match.environmentId}:${match.threadId}`);
  const rankedMessageItems = rankMessageMatches(
    messageSearch.matches,
    (match) => itemForMatch(match)?.threadSearch,
    foldSearchQuery(threadSearchQuery),
    now,
    { withoutTitleMatches: true },
  ).flatMap((match) => {
    const item = itemForMatch(match);
    if (!item) return [];
    // The snippet replaces the project line, so a message row is as tall as a title row.
    const { description: _description, ...rest } = item;
    return [
      {
        ...rest,
        // When the matching message was written, not when the thread last moved.
        ...(match.messageCreatedAt
          ? { timestamp: formatRelativeTimeLabel(match.messageCreatedAt, undefined, messages) }
          : {}),
        threadContentMatch: {
          source: match.source,
          snippet: match.snippet,
          query: messageSearch.query,
        },
        // Opens the thread with find on the word at the matched message, so it is in view.
        run: async () => {
          await item.run();
          openThreadFindOnQuery(
            scopedThreadKey(scopeThreadRef(match.environmentId, match.threadId)),
            findForMessageMatch(match, messageSearch.query),
          );
        },
      },
    ];
  });

  // Rows already shown keep their places when a slower environment answers.
  const [shownOrder, setShownOrder] = useState<ShownOrder | null>(null);
  const order = nextShownOrder(
    shownOrder,
    messageSearch.query,
    rankedMessageItems.map((item) => item.value),
    PALETTE_MESSAGE_LIMIT,
  );
  if (order !== shownOrder) setShownOrder(order);
  const messageItemByValue = new Map(rankedMessageItems.map((item) => [item.value, item]));
  const threadMessageItems = order.keys
    .slice(0, order.shown)
    .flatMap((value) => messageItemByValue.get(value) ?? []);

  return {
    threadItems,
    threadMessageItems,
    now,
    isSearchPending: messageSearch.isPending,
    isSearchFailed: messageSearch.failed,
  };
}
