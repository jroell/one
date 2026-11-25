import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";
import { msg } from "gt-react";

import { m, type MessageResolver } from "./i18n/messages";

export type ThreadSyncPhase = "loading" | "syncing" | "failed";

export function resolveThreadSyncPhase(input: {
  readonly detailExists: boolean;
  readonly shellExists: boolean;
  readonly status: EnvironmentThreadStatus;
  readonly hasError: boolean;
}): ThreadSyncPhase | null {
  if (!input.shellExists) {
    return null;
  }

  switch (input.status) {
    case "empty":
    case "cached":
      // Nothing is outstanding: the thread shows what it has until something subscribes to it.
      if (!input.detailExists) return "loading";
      return input.hasError ? "failed" : null;
    case "synchronizing":
      if (!input.detailExists) return "loading";
      return input.hasError ? "failed" : "syncing";
    case "deleted":
    case "live":
      return null;
  }
}

/** True while the transcript on screen may lag the server: not live, whether or not a status shows. */
export function threadTranscriptMayLag(input: {
  readonly shellExists: boolean;
  readonly status: EnvironmentThreadStatus;
}): boolean {
  return input.shellExists && input.status !== "live" && input.status !== "deleted";
}

export function threadSyncLabel(phase: ThreadSyncPhase, resolve: MessageResolver = m): string {
  switch (phase) {
    case "loading":
      return resolve(msg("Loading messages..."));
    case "syncing":
      return resolve(msg("Syncing messages..."));
    case "failed":
      return resolve(msg("Could not sync messages"));
  }
}
