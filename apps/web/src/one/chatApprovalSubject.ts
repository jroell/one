import type { RuntimeRequestId } from "@t3tools/contracts";
import { createContext } from "react";

import type { TimelineEntry } from "~/session-logic";

/** What a file change approval asks to change, read from the file change item it names. */
export interface ApprovalSubject {
  readonly path: string;
  /** Further files in the same change. */
  readonly moreFiles: number;
  readonly additions: number | null;
  readonly deletions: number | null;
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
  if (pendingApprovals.size === 0) return NO_SUBJECTS;
  const changes = new Map<string, ApprovalSubject>();
  const requests: Array<{ requestId: RuntimeRequestId; key: string }> = [];
  for (const entry of entries) {
    if (entry.kind !== "work") continue;
    const item = entry.entry.projectedItem?.item ?? entry.entry.structuredPayload;
    const key = item ? nativeItemKey(item) : null;
    if (item === undefined || key === null) continue;
    if (item.type === "file_change") {
      const files = item.changes?.length ?? 0;
      changes.set(key, {
        path: item.fileName,
        moreFiles: Math.max(0, files - 1),
        additions: item.additions ?? null,
        deletions: item.deletions ?? null,
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
  for (const { requestId, key } of requests) {
    const subject = changes.get(key);
    if (subject) subjects.set(requestId, subject);
  }
  return subjects.size === 0 ? NO_SUBJECTS : subjects;
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
