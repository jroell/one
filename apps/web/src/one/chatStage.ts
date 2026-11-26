import { createContext, useEffect, useState } from "react";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";

/** Where the waiting stage sits: under the question it restates, until an answer starts. */
export interface ChatStageTarget {
  readonly userRowId: string;
  readonly question: string;
  /** When the turn began, for the elapsed time beside the arc. */
  readonly since: string | null;
}

export interface ChatStage extends ChatStageTarget {
  /** False while the stage hands over to the answer: it takes no room and fades out. */
  readonly active: boolean;
}

export const ChatStageContext = createContext<ChatStage | null>(null);

/** The first answer after the stage's question, while the stage hands over to it; else null. */
export const ChatHandoffAnswerContext = createContext<string | null>(null);

export function findHandoffAnswerId(
  rows: ReadonlyArray<MessagesTimelineRow>,
  userRowId: string,
): string | null {
  const from = rows.findIndex((row) => row.id === userRowId);
  if (from < 0) return null;
  for (const row of rows.slice(from + 1)) {
    // The same rule that keeps the stage until words arrive: an answer with none is not the one.
    if (
      row.kind === "message" &&
      row.message.role === "assistant" &&
      row.message.text.trim() !== ""
    ) {
      return row.id;
    }
  }
  return null;
}

/** An unclipped layer over the timeline, where a stage that is handing over fades out. */
export const ChatStageLayerContext = createContext<HTMLElement | null>(null);

/** The picture fades out as the answer's first words fade in (180ms), then it is removed. */
export const CHAT_STAGE_HOLD_MS = 240;

/**
 * The stage shows while a turn works and nothing of its answer has arrived: the rows end on the
 * person's message, with at most work rows after it. A request that waits on the person has its
 * own line.
 */
export function findChatStageTarget(
  rows: ReadonlyArray<MessagesTimelineRow>,
  state: { readonly turnRunning: boolean; readonly awaitingPerson: boolean },
): ChatStageTarget | null {
  if (!state.turnRunning || state.awaitingPerson) return null;
  let since: string | null = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind === "working") since ??= row.createdAt ?? null;
    if (row.kind !== "message" && row.kind !== "assistant-meta") continue;
    if (row.message.role === "system") continue;
    // An answer with no words yet has nothing to show: the stage stays until its first words.
    if (row.message.role === "assistant" && row.message.text.trim().length === 0) continue;
    if (row.message.role !== "user") return null;
    return { userRowId: row.id, question: row.message.text.trim(), since };
  }
  return null;
}

/**
 * Keeps the stage mounted for `CHAT_STAGE_HOLD_MS` after it stops being the target, so it can
 * fade out in place rather than blink off. `identity` resets it when another thread opens. A turn
 * that has asked the person for something is retired: once it is answered the turn has begun, so
 * the stage does not come back for it.
 */
export function useChatStage(
  identity: string,
  candidate: ChatStageTarget | null,
  awaitingPerson: boolean,
): ChatStage | null {
  const [retired, setRetired] = useState<{ identity: string; userRowId: string } | null>(null);
  if (
    awaitingPerson &&
    candidate !== null &&
    (retired?.identity !== identity || retired.userRowId !== candidate.userRowId)
  ) {
    setRetired({ identity, userRowId: candidate.userRowId });
  }
  const isRetired =
    candidate !== null &&
    retired?.identity === identity &&
    retired.userRowId === candidate.userRowId;
  const target = candidate !== null && !awaitingPerson && !isRetired ? candidate : null;
  const [held, setHeld] = useState<{ identity: string; target: ChatStageTarget } | null>(null);
  if (target !== null && (held?.identity !== identity || !sameTarget(held.target, target))) {
    setHeld({ identity, target });
  } else if (held !== null && held.identity !== identity) {
    setHeld(null);
  }
  const leaving = target === null && held !== null && held.identity === identity;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a timer removes the faded stage; no event says when its fade ends under reduced motion
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setHeld(null), CHAT_STAGE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  if (target !== null) return { ...target, active: true };
  return leaving && held !== null ? { ...held.target, active: false } : null;
}

function sameTarget(a: ChatStageTarget, b: ChatStageTarget): boolean {
  return a.userRowId === b.userRowId && a.question === b.question && a.since === b.since;
}

/**
 * Asks the timeline to stop following its end for a moment, for something the person does that
 * makes an answer taller (a quiz revealing its explanation). What they are reading stays put.
 */
export const ChatEndHoldContext = createContext<() => void>(() => {});
