import type { ApprovalSubjectChange } from "~/one/chatApprovalSubject";

export type ApprovalVerb = "add" | "delete" | "rename" | "edit";

/** What happens to one file, from the operation the provider recorded. */
export function approvalVerb(change: ApprovalSubjectChange): ApprovalVerb {
  const operation = change.operation.trim().toLowerCase();
  if (operation === "add" || operation === "create" || operation === "new") return "add";
  if (operation === "delete" || operation === "remove") return "delete";
  if (
    operation === "rename" ||
    operation === "move" ||
    (change.oldPath !== undefined && change.oldPath !== change.path)
  ) {
    return "rename";
  }
  return "edit";
}

/** The header's verb for the whole approval: one verb when every file shares it, else "change". */
export function approvalHeaderVerb(
  changes: ReadonlyArray<ApprovalSubjectChange>,
): ApprovalVerb | "change" {
  const verbs = new Set(changes.map(approvalVerb));
  if (verbs.size === 0) return "edit";
  return verbs.size === 1 ? [...verbs][0]! : "change";
}

/** Rows shown before the rest of the files fold behind "N more files". */
export const APPROVAL_FILES_SHOWN = 5;
