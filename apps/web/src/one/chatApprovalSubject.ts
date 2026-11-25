import type { RuntimeRequestId } from "@t3tools/contracts";
import { createContext } from "react";

import type { TimelineEntry } from "~/session-logic";

/** What a file change approval asks to change, read from the file change that precedes it. */
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
 * The file each pending file change approval is about. A provider's own prompt is often generic
 * ("Changed files"); the file change entry just before the request carries the path and counts.
 * Reads every entry, including the ones a mode keeps off the screen.
 */
export function deriveApprovalSubjects(
  entries: ReadonlyArray<TimelineEntry>,
  pendingApprovals: ReadonlySet<RuntimeRequestId>,
): ReadonlyMap<RuntimeRequestId, ApprovalSubject> {
  if (pendingApprovals.size === 0) return NO_SUBJECTS;
  const subjects = new Map<RuntimeRequestId, ApprovalSubject>();
  for (const [index, entry] of entries.entries()) {
    if (entry.kind !== "work") continue;
    const request = entry.entry.projectedItem?.item;
    if (
      request?.type !== "approval_request" ||
      request.requestKind !== "file-change" ||
      !pendingApprovals.has(request.requestId)
    ) {
      continue;
    }
    for (let back = index - 1; back >= 0; back -= 1) {
      const candidate = entries[back]!;
      if (candidate.kind !== "work") break;
      const item = candidate.entry.projectedItem?.item ?? candidate.entry.structuredPayload;
      if (item?.type !== "file_change") continue;
      const files = item.changes?.length ?? 0;
      subjects.set(request.requestId, {
        path: item.fileName,
        moreFiles: Math.max(0, files - 1),
        additions: item.additions ?? null,
        deletions: item.deletions ?? null,
      });
      break;
    }
  }
  return subjects.size === 0 ? NO_SUBJECTS : subjects;
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
