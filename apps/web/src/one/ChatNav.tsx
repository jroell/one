import { useLayoutEffect, useState, type ReactNode, type Ref } from "react";

import type { TimelineMinimapItem } from "~/components/chat/timelineMinimapItems";
import { useClientSettings } from "~/hooks/useSettings";
import { useStableCallback } from "~/hooks/useStableCallback";
import { observeResize } from "~/lib/observeResize";

import { CHAT_OUTLINE_MIN_TURNS, ChatOutline } from "./ChatOutline";
import { chatOutlineFits } from "./chatOutlineLayout";
import type { ChatSection } from "./chatSections";

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
  sections,
  onSelectSection,
  onWheel,
  onShownChange,
  progressRef,
  children,
}: {
  readonly items: ReadonlyArray<TimelineMinimapItem>;
  readonly currentId: string | null;
  readonly threadKey: string;
  readonly onSelect: (item: TimelineMinimapItem) => void;
  readonly sections: ReadonlyMap<string, ReadonlyArray<ChatSection>>;
  readonly onSelectSection: (section: ChatSection) => void;
  readonly onWheel: (event: WheelEvent) => void;
  /** Whether the outline is mounted, so the timeline measures the current turn only then. */
  readonly onShownChange: (shown: boolean) => void;
  /** The reading-position hairline; the timeline sets its `--one-chat-read` while it scrolls. */
  readonly progressRef: Ref<HTMLDivElement>;
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
  const hasSections = [...sections.values()].reduce((total, list) => total + list.length, 0) >= 1;
  const showsOutline =
    fits &&
    (items.length >= CHAT_OUTLINE_MIN_TURNS || (items.length > 0 && hasSections)) &&
    chatWidth !== "wide" &&
    chatWidth !== "full";
  const reportShown = useStableCallback(onShownChange);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the timeline's scroll loop, which holds no render state, whether it must measure turns
  useLayoutEffect(() => {
    reportShown(showsOutline);
    return () => reportShown(false);
  }, [showsOutline, reportShown]);
  return (
    <div className="one-chat-nav" ref={hostRef}>
      <div className="one-chat-progress" aria-hidden ref={progressRef}>
        <span />
      </div>
      {showsOutline ? (
        <ChatOutline
          items={items}
          currentId={currentId}
          threadKey={threadKey}
          onSelect={onSelect}
          sections={sections}
          onSelectSection={onSelectSection}
          onWheel={onWheel}
        />
      ) : null}
      {children}
    </div>
  );
}
