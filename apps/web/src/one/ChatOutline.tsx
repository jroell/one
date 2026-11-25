import {
  assistantCitationsToPlainText,
  splitsSurrogatePair,
} from "@t3tools/shared/assistantCitations";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { useGT } from "gt-react";
import { memo, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import type { TimelineMinimapItem } from "~/components/chat/timelineMinimapItems";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

/** An outline of one or two turns is shorter than the screen it sits beside. */
export const CHAT_OUTLINE_MIN_TURNS = 3;
const LABEL_SOURCE_LENGTH = 240;
// Leading markdown markers that read as noise in a one-line label.
const LEADING_MARKERS = /^(?:#{1,6}|>|[-*+]|\d+[.)])\s+/;

/** The first line a person wrote, as plain text. Null when there is nothing to show. */
export function outlineLabel(userText: string | null): string | null {
  if (userText === null) return null;
  const source = userText.slice(0, splitsSurrogatePair(userText, LABEL_SOURCE_LENGTH) ? 239 : 240);
  const plain = assistantCitationsToPlainText(
    replaceComposerContextReferences(source, (reference) => reference.label),
  );
  const firstLine = plain
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const label = firstLine?.replace(LEADING_MARKERS, "").replace(/\s+/g, " ").trim();
  return label ? label : null;
}

// Labels by message id, so a render that only moves the current mark reads no message text.
const LABEL_CACHE_LIMIT = 4000;
const labelCache = new Map<
  string,
  { readonly text: string | null; readonly label: string | null }
>();

function cachedOutlineLabel(id: string, text: string | null): string | null {
  const cached = labelCache.get(id);
  if (cached?.text === text) return cached.label;
  if (labelCache.size >= LABEL_CACHE_LIMIT) labelCache.clear();
  const label = outlineLabel(text);
  labelCache.set(id, { text, label });
  return label;
}

interface ChatOutlineProps {
  readonly items: ReadonlyArray<TimelineMinimapItem>;
  /** The message id of the turn being read; null until the list has measured. */
  readonly currentId: string | null;
  /** Identifies the thread, so a pick made in another thread is never carried over. */
  readonly threadKey: string;
  readonly onSelect: (item: TimelineMinimapItem) => void;
  /** The outline sits over the gutter, so a wheel turn there scrolls the timeline. */
  readonly onWheel: (event: WheelEvent) => void;
}

function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const buttons = [
    ...(event.currentTarget.closest("ol")?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ];
  const at = buttons.indexOf(event.currentTarget);
  const target =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : Math.max(0, Math.min(buttons.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)));
  event.preventDefault();
  buttons[target]?.focus();
}

const OutlineEntry = memo(function OutlineEntry({
  id,
  label,
  current,
  tabbable,
  onPick,
}: {
  readonly id: string;
  readonly label: string;
  readonly current: boolean;
  readonly tabbable: boolean;
  readonly onPick: (id: string) => void;
}) {
  return (
    <li className="one-chat-outline-item">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="one-chat-outline-button"
              aria-current={current ? "true" : undefined}
              tabIndex={tabbable ? 0 : -1}
              onClick={() => onPick(id)}
              onKeyDown={moveFocus}
            />
          }
        >
          <span className="one-chat-outline-text">{label}</span>
        </TooltipTrigger>
        <TooltipPopup side="left">{label}</TooltipPopup>
      </Tooltip>
    </li>
  );
});

/**
 * The right-hand outline of a Chat mode thread: one entry per user turn. It reads
 * the timeline minimap's items, and a pick scrolls through the minimap's own
 * navigation. Its host mounts it only where it fits beside the reading column.
 */
export function ChatOutline({ items, currentId, threadKey, onSelect, onWheel }: ChatOutlineProps) {
  const gt = useGT();
  const scrollerRef = useRef<HTMLDivElement>(null);
  // A pick that cannot scroll (the thread already fits, or it is at the end) still
  // marks the entry the person chose, until scrolling moves the timeline's own mark.
  const [pick, setPick] = useState<{
    id: string;
    threadKey: string;
    basis: string | null;
  } | null>(null);
  if (pick !== null && (pick.threadKey !== threadKey || pick.basis !== currentId)) setPick(null);
  const readingId = pick?.id ?? currentId;
  const reading = readingId === null ? -1 : items.findIndex((item) => item.id === readingId);
  const current = reading === -1 ? null : reading;

  const onPick = useStableCallback((id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    setPick({ id, threadKey, basis: currentId });
    onSelect(item);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the current entry inside the outline's own scroller, which only the DOM can measure
  useEffect(() => {
    const scroller = scrollerRef.current;
    const entry = current === null ? undefined : scroller?.querySelectorAll("li")[current];
    if (!scroller || !entry) return;
    if (entry.offsetTop < scroller.scrollTop) {
      scroller.scrollTop = entry.offsetTop;
    } else if (entry.offsetTop + entry.offsetHeight > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = entry.offsetTop + entry.offsetHeight - scroller.clientHeight;
    }
  }, [current]);

  if (items.length < CHAT_OUTLINE_MIN_TURNS) return null;

  const title = gt("In this chat");
  const fallback = gt("User message");
  const wheelTargetRef = (node: HTMLElement | null) => {
    if (!node) return;
    const forward = (event: WheelEvent) => {
      const scroller = scrollerRef.current;
      if (scroller && scroller.scrollHeight - scroller.clientHeight > 1) return;
      onWheel(event);
    };
    node.addEventListener("wheel", forward, { passive: false });
    return () => node.removeEventListener("wheel", forward);
  };

  return (
    <nav className="one-chat-outline" aria-label={title} ref={wheelTargetRef}>
      <p className="one-chat-outline-title" aria-hidden="true">
        {title}
      </p>
      <div className="one-chat-outline-scroller" ref={scrollerRef}>
        <ol
          className="one-chat-outline-list"
          data-current={current === null ? undefined : ""}
          style={{ "--one-chat-outline-index": current ?? 0 } as CSSProperties}
        >
          {items.map((item, index) => (
            <OutlineEntry
              key={item.id}
              id={item.id}
              label={cachedOutlineLabel(item.id, item.userText) ?? fallback}
              current={index === current}
              tabbable={index === (current ?? 0)}
              onPick={onPick}
            />
          ))}
        </ol>
      </div>
    </nav>
  );
}
