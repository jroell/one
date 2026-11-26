import { createContext, useEffect, useState, type AnimationEvent } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";

export interface ArrivalMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  /** True while the answer streams in; it reveals block by block then, never as an arrival. */
  readonly streaming?: boolean;
}

export interface ArrivalState {
  readonly identity: string;
  /** Every message id this thread has shown, so a row that remounts never arrives twice. */
  readonly seen: ReadonlySet<string>;
  /** Message ids in list order at the last render. */
  readonly order: ReadonlyArray<string>;
  /** Assistant rows whose arrival animation has not finished yet. */
  readonly fresh: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

function startingState(identity: string, messages: ReadonlyArray<ArrivalMessage>): ArrivalState {
  const order = messages.map((message) => message.id);
  return { identity, seen: new Set(order), order, fresh: NONE };
}

/**
 * Finds the assistant messages that arrived after the previous render. Only a
 * message past the last one already on screen counts: the first paint of a
 * thread, a thread switch, earlier history loading above, and a rewritten list
 * all arrive silently.
 */
export function advanceArrivals(
  previous: ArrivalState | null,
  identity: string,
  messages: ReadonlyArray<ArrivalMessage>,
  animate: boolean,
): ArrivalState {
  if (previous === null || previous.identity !== identity) return startingState(identity, messages);
  // The first messages of a thread that was empty are its first paint, not arrivals.
  if (previous.order.length === 0) {
    return messages.length === 0 ? previous : startingState(identity, messages);
  }
  const ids = messages.map((message) => message.id);
  const present = new Set(ids);
  const anchor = previous.order.findLast((id) => present.has(id));
  if (anchor === undefined) return startingState(identity, messages);

  const anchorIndex = ids.indexOf(anchor);
  const fresh = new Set([...previous.fresh].filter((id) => present.has(id)));
  const seen = new Set(previous.seen);
  for (const [index, message] of messages.entries()) {
    // A streaming answer already reveals block by block; marking it would replay the whole
    // reveal from hidden when the stream ends.
    if (message.streaming === true) fresh.delete(message.id);
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    if (
      animate &&
      message.streaming !== true &&
      index > anchorIndex &&
      message.role === "assistant"
    ) {
      fresh.add(message.id);
    }
  }

  const unchanged =
    seen.size === previous.seen.size &&
    fresh.size === previous.fresh.size &&
    ids.length === previous.order.length &&
    ids.every((id, index) => id === previous.order[index]) &&
    [...fresh].every((id) => previous.fresh.has(id));
  return unchanged ? previous : { identity, seen, order: ids, fresh };
}

export interface ChatArrival {
  readonly fresh: ReadonlySet<string>;
  readonly settle: (messageId: string) => void;
  /** True once a mounted row has started this message's reveal. */
  readonly hasPlayed: (messageId: string) => boolean;
  readonly markPlayed: (messageId: string) => void;
}

export const ChatArrivalContext = createContext<ChatArrival>({
  fresh: NONE,
  settle: () => {},
  hasPlayed: () => false,
  markPlayed: () => {},
});

/**
 * A row that never mounts (the answer arrived while scrolled away) cannot report the end of its
 * animation, so a mark lasts this long at most: the whole paragraph-by-paragraph reveal.
 */
export const CHAT_ARRIVAL_EXPIRY_MS = 1600;

/**
 * Tracks which assistant rows just arrived. `animate` is false outside Chat mode and under
 * reduced motion: the messages are then never read, and a mark still showing is dropped.
 */
export function useChatArrival(
  identity: string,
  readMessages: () => ReadonlyArray<ArrivalMessage>,
  animate: boolean,
): ChatArrival {
  const [state, setState] = useState<ArrivalState | null>(() =>
    animate ? startingState(identity, readMessages()) : null,
  );
  let current = state;
  if (!animate) {
    if (state !== null) setState(null);
    current = null;
  } else if (state === null) {
    // Animation just turned on: what is on screen now is the starting point, not an arrival.
    current = startingState(identity, readMessages());
    setState(current);
  } else {
    current = advanceArrivals(state, identity, readMessages(), true);
    if (current !== state) setState(current);
  }
  const settle = useStableCallback((messageId: string) =>
    setState((previous) =>
      previous?.fresh.has(messageId)
        ? { ...previous, fresh: new Set([...previous.fresh].filter((id) => id !== messageId)) }
        : previous,
    ),
  );
  const fresh = current?.fresh ?? NONE;
  // Message ids whose reveal has started on screen; a row that remounts inside the marker skips it.
  const [played] = useState(() => new Set<string>());
  const hasPlayed = useStableCallback((messageId: string) => played.has(messageId));
  const markPlayed = useStableCallback((messageId: string) => {
    played.add(messageId);
  });
  // One expiry per message, started when it first shows as fresh, so a later arrival never moves it.
  const [expiries] = useState(() => new Map<string, ReturnType<typeof setTimeout>>());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a mark whose row never mounted gets no animationend, so a timer retires it
  useEffect(() => {
    for (const [id, timer] of expiries) {
      if (fresh.has(id)) continue;
      clearTimeout(timer);
      expiries.delete(id);
    }
    for (const id of fresh) {
      if (expiries.has(id)) continue;
      expiries.set(
        id,
        setTimeout(() => {
          expiries.delete(id);
          settle(id);
        }, CHAT_ARRIVAL_EXPIRY_MS),
      );
    }
  }, [fresh, settle, expiries]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the pending expiries when the thread's timeline unmounts
  useEffect(
    () => () => {
      for (const timer of expiries.values()) clearTimeout(timer);
      expiries.clear();
    },
    [expiries],
  );
  return { fresh, settle, hasPlayed, markPlayed };
}

const CHAT_ARRIVAL_ANIMATION = "one-chat-arrive";

/**
 * Row attributes: the marker CSS animates, and the end of that animation retires the mark. A
 * message plays once: a remount after its reveal started never restarts it from hidden.
 */
export function useChatArrivalProps(arrival: ChatArrival, messageId: string | null) {
  const canPlay = (id: string | null) =>
    id !== null && arrival.fresh.has(id) && !arrival.hasPlayed(id);
  // A recycled row container can be handed another message, so the claim is per message id.
  const [claim, setClaim] = useState({ id: messageId, plays: canPlay(messageId) });
  let plays = claim.plays;
  if (claim.id !== messageId) {
    plays = canPlay(messageId);
    setClaim({ id: messageId, plays });
  }
  if (messageId === null || !plays || !arrival.fresh.has(messageId)) return {};
  const own = (event: AnimationEvent<HTMLElement>) =>
    event.target === event.currentTarget && event.animationName === CHAT_ARRIVAL_ANIMATION;
  return {
    "data-chat-arrival": "",
    onAnimationStart: (event: AnimationEvent<HTMLElement>) => {
      if (own(event)) arrival.markPlayed(messageId);
    },
    onAnimationEnd: (event: AnimationEvent<HTMLElement>) => {
      if (own(event)) arrival.settle(messageId);
    },
  };
}
