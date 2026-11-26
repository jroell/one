import { useEffect, useState } from "react";

import {
  approvalPreviewFor,
  type ApprovalHunkPreview,
  type ApprovalPreviewSource,
} from "./approvalHunk";

type Job = () => void;

const queue: Job[] = [];
let draining = false;

/**
 * One preview at a time, each in its own task. The work is bounded already; running it in a task
 * of its own means the card paints, and Approve and Decline answer, before any of it starts, and
 * many cards in a long thread never compute at once.
 */
function schedule(job: Job): void {
  queue.push(job);
  if (draining) return;
  draining = true;
  setTimeout(drain, 0);
}

function drain(): void {
  const job = queue.shift();
  if (job === undefined) {
    draining = false;
    return;
  }
  job();
  setTimeout(drain, 0);
}

export interface ApprovalPreviewState {
  /** False until the preview for the current source has been computed. */
  readonly ready: boolean;
  readonly preview: ApprovalHunkPreview | null;
}

const NOT_READY: ApprovalPreviewState = { ready: false, preview: null };

/** The card's preview of a change, computed after the first paint and never during render. */
export function useApprovalPreview(source: ApprovalPreviewSource | null): ApprovalPreviewState {
  const [computed, setComputed] = useState<{
    readonly source: ApprovalPreviewSource;
    readonly preview: ApprovalHunkPreview | null;
  } | null>(null);
  const diffStr = source?.diffStr;
  const oldStr = source?.oldStr;
  const newStr = source?.newStr;
  const operation = source?.operation;
  const present = source !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the preview is computed in a queued task after paint, so it lands in state rather than in render
  useEffect(() => {
    if (!present) return;
    let live = true;
    const input = { diffStr, oldStr, newStr, operation };
    schedule(() => {
      if (live) setComputed({ source: input, preview: approvalPreviewFor(input) });
    });
    return () => {
      live = false;
    };
  }, [present, diffStr, oldStr, newStr, operation]);
  if (
    source === null ||
    computed === null ||
    computed.source.diffStr !== diffStr ||
    computed.source.oldStr !== oldStr ||
    computed.source.newStr !== newStr ||
    computed.source.operation !== operation
  ) {
    return NOT_READY;
  }
  return { ready: true, preview: computed.preview };
}
