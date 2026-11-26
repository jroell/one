import { useEffect, useState } from "react";

import {
  approvalPreviewFor,
  type ApprovalHunkPreview,
  type ApprovalPreviewSource,
} from "./approvalHunk";

/** One task at a time, each in a timer turn of its own; a cancelled task leaves the queue. */
export function createTaskQueue() {
  const queue: Array<() => void> = [];
  let draining = false;
  const drain = () => {
    const job = queue.shift();
    if (job === undefined) {
      draining = false;
      return;
    }
    job();
    setTimeout(drain, 0);
  };
  return (job: () => void): (() => void) => {
    queue.push(job);
    if (!draining) {
      draining = true;
      setTimeout(drain, 0);
    }
    return () => {
      const index = queue.indexOf(job);
      if (index !== -1) queue.splice(index, 1);
    };
  };
}

/**
 * One preview at a time, each in its own task. The card paints, and Approve and Decline answer,
 * before any of it starts, and cards scrolled past never compute.
 */
const schedule = createTaskQueue();

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
  const path = source?.path;
  const present = source !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the preview is computed in a queued task after paint, so it lands in state rather than in render
  useEffect(() => {
    if (!present) return;
    const input = { diffStr, oldStr, newStr, operation, path };
    return schedule(() => setComputed({ source: input, preview: approvalPreviewFor(input) }));
  }, [present, diffStr, oldStr, newStr, operation, path]);
  if (
    source === null ||
    computed === null ||
    computed.source.diffStr !== diffStr ||
    computed.source.oldStr !== oldStr ||
    computed.source.newStr !== newStr ||
    computed.source.operation !== operation ||
    computed.source.path !== path
  ) {
    return NOT_READY;
  }
  return { ready: true, preview: computed.preview };
}
