import type { RuntimeRequestId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { createContext } from "react";

import type { ToolCallDiffTarget } from "~/diffPanelStore";
import type { TimelineEntry } from "~/session-logic";

/** What a file change approval asks to change, read from the file change item it names. */
export interface ApprovalSubject {
  readonly path: string;
  /** Further files in the same change. */
  readonly moreFiles: number;
  readonly additions: number | null;
  readonly deletions: number | null;
  /** The matched change's own patch, when the item carries one. */
  readonly diffStr: string | null;
  /** Opens the full diff for exactly this change. */
  readonly diffTarget: ToolCallDiffTarget | null;
}

const NO_SUBJECTS: ReadonlyMap<RuntimeRequestId, ApprovalSubject> = new Map();

export const ApprovalSubjectContext = createContext(NO_SUBJECTS);

/**
 * The file each pending file change approval is about: the file change item with the same
 * provider, turn and native item id. Without that exact item the approval gets no subject, so the
 * row shows its own details rather than an earlier edit.
 */
export function deriveApprovalSubjects(
  entries: ReadonlyArray<TimelineEntry>,
  pendingApprovals: ReadonlySet<RuntimeRequestId>,
): ReadonlyMap<RuntimeRequestId, ApprovalSubject> {
  return scanApprovals(entries, pendingApprovals).subjects;
}

/**
 * The file change entries a pending approval card already names. The card's header carries the
 * path, so the edit row above it would repeat it and leaves the rows while the card shows.
 */
export function approvalCoveredEntryIds(
  entries: ReadonlyArray<TimelineEntry>,
  pendingApprovals: ReadonlySet<RuntimeRequestId> | undefined,
): ReadonlySet<string> {
  return pendingApprovals === undefined || pendingApprovals.size === 0
    ? NO_ENTRY_IDS
    : scanApprovals(entries, pendingApprovals).coveredEntryIds;
}

const NO_ENTRY_IDS: ReadonlySet<string> = new Set();

function scanApprovals(
  entries: ReadonlyArray<TimelineEntry>,
  pendingApprovals: ReadonlySet<RuntimeRequestId>,
): {
  subjects: ReadonlyMap<RuntimeRequestId, ApprovalSubject>;
  coveredEntryIds: ReadonlySet<string>;
} {
  if (pendingApprovals.size === 0) return { subjects: NO_SUBJECTS, coveredEntryIds: NO_ENTRY_IDS };
  const changes = new Map<string, { subject: ApprovalSubject; entryId: string }>();
  const requests: Array<{ requestId: RuntimeRequestId; key: string }> = [];
  for (const entry of entries) {
    if (entry.kind !== "work") continue;
    const item = entry.entry.projectedItem?.item ?? entry.entry.structuredPayload;
    const key = item ? nativeItemKey(item) : null;
    if (item === undefined || key === null) continue;
    if (item.type === "file_change") {
      const files = item.changes?.length ?? 0;
      changes.set(key, {
        entryId: entry.id,
        subject: {
          path: item.fileName,
          moreFiles: Math.max(0, files - 1),
          additions: item.additions ?? null,
          deletions: item.deletions ?? null,
          diffStr: item.diffStr?.trim() ? item.diffStr : null,
          diffTarget: {
            threadId: entry.entry.projectedItem?.sourceThreadId ?? item.threadId,
            itemId: entry.entry.projectedItem?.sourceItemId ?? item.id,
            // A waiting item keeps the shared "live" revision, which would reuse its first answer
            // after an in-place update. The card follows the item's own update time instead.
            revision: DateTime.formatIso(item.updatedAt),
          },
        },
      });
    } else if (
      item.type === "approval_request" &&
      item.requestKind === "file-change" &&
      pendingApprovals.has(item.requestId)
    ) {
      requests.push({ requestId: item.requestId, key });
    }
  }
  const subjects = new Map<RuntimeRequestId, ApprovalSubject>();
  const coveredEntryIds = new Set<string>();
  for (const { requestId, key } of requests) {
    const change = changes.get(key);
    if (!change) continue;
    subjects.set(requestId, change.subject);
    coveredEntryIds.add(change.entryId);
  }
  return {
    subjects: subjects.size === 0 ? NO_SUBJECTS : subjects,
    coveredEntryIds: coveredEntryIds.size === 0 ? NO_ENTRY_IDS : coveredEntryIds,
  };
}

function nativeItemKey(item: {
  readonly providerTurnId: string | null;
  readonly nativeItemRef: { readonly driver: string; readonly nativeId: string | null } | null;
}): string | null {
  const ref = item.nativeItemRef;
  if (item.providerTurnId === null || ref === null || ref.nativeId === null) return null;
  return JSON.stringify([ref.driver, item.providerTurnId, ref.nativeId]);
}

/** Splits a path so its directory can shrink with an ellipsis while the file name always shows. */
export function splitPathForEllipsis(path: string): { directory: string; name: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1
    ? { directory: "", name: path }
    : { directory: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

/** The path below the workspace root, when it sits in it; the title line has little room. */
export function relativeToWorkspace(path: string, workspaceRoot: string | undefined): string {
  if (!workspaceRoot) return path;
  const root = workspaceRoot.endsWith("/") ? workspaceRoot : `${workspaceRoot}/`;
  return path.startsWith(root) && path.length > root.length ? path.slice(root.length) : path;
}

/** A provider prompt that only restates the request kind adds nothing under the subject. */
const GENERIC_FILE_CHANGE_PROMPTS = new Set(["changed files", "file change", "file changes"]);

export function isGenericFileChangePrompt(prompt: string | undefined): boolean {
  const text = prompt?.trim().toLowerCase();
  return text === undefined || text === "" || GENERIC_FILE_CHANGE_PROMPTS.has(text);
}
