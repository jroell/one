import { useState, type ReactNode } from "react";

import type { TimelineMinimapItem } from "~/components/chat/timelineMinimapItems";
import { useClientSettings } from "~/hooks/useSettings";
import { observeResize } from "~/lib/observeResize";

import { CHAT_OUTLINE_MIN_TURNS, ChatOutline } from "./ChatOutline";
import { chatOutlineFits } from "./chatOutlineLayout";

/**
 * The host over the timeline in Chat mode. It mounts the outline only where the outline has room:
 * enough turns, a comfortable chat width, a wide enough gutter and rows to read. Everywhere else
 * the timeline minimap stays, and nothing of the outline exists.
 */
export function ChatNav({
  items,
  currentId,
  threadKey,
  onSelect,
  onWheel,
  children,
}: {
  readonly items: ReadonlyArray<TimelineMinimapItem>;
  readonly currentId: string | null;
  readonly threadKey: string;
  readonly onSelect: (item: TimelineMinimapItem) => void;
  readonly onWheel: (event: WheelEvent) => void;
  /** The timeline minimap, which the outline replaces when it shows. */
  readonly children: ReactNode;
}) {
  const chatWidth = useClientSettings((settings) => settings.chatWidth);
  const [fits, setFits] = useState(false);
  const hostRef = (node: HTMLDivElement | null) => {
    if (!node) return;
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setFits(chatOutlineFits({ width: node.clientWidth, height: node.clientHeight, rem }));
    };
    measure();
    return observeResize(node, measure);
  };
  const showsOutline =
    fits && items.length >= CHAT_OUTLINE_MIN_TURNS && chatWidth !== "wide" && chatWidth !== "full";
  return (
    <div className="one-chat-nav" ref={hostRef}>
      {showsOutline ? (
        <ChatOutline
          items={items}
          currentId={currentId}
          threadKey={threadKey}
          onSelect={onSelect}
          onWheel={onWheel}
        />
      ) : null}
      {children}
    </div>
  );
}
