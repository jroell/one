import { useGT } from "gt-react";
import { use } from "react";

import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";

import { ChatStatusScopeContext, useChatStatus } from "./chatStatus";

/**
 * Everything quiet in Chat mode lives behind one dot in the header: it is gold while something
 * is being prepared and gray otherwise, and it shows nothing at all when there is nothing to say.
 */
export function ChatStatusDot() {
  const gt = useGT();
  const items = useChatStatus(use(ChatStatusScopeContext));
  if (items.length === 0) return null;
  const working = items.some((item) => item.kind === "working");
  return (
    <Popover>
      <span className="one-chat-status" data-chat-status="" data-working={working ? "" : undefined}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost-muted"
              size="icon-sm-pill"
              aria-label={
                working
                  ? gt("Getting ready. Show status.")
                  : gt("{count, plural, one {# note} other {# notes}}. Show status.", {
                      count: items.length,
                    })
              }
            />
          }
        >
          <span className="one-chat-status-dot" aria-hidden="true" />
        </PopoverTrigger>
      </span>
      <PopoverPopup side="bottom" align="end" width="md">
        <ul className="one-chat-status-list">
          {items.map((item) => (
            <li key={item.id}>
              <p className="one-chat-status-title">{item.title}</p>
              {item.detail !== null ? (
                <p className="one-chat-status-detail">{item.detail}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </PopoverPopup>
    </Popover>
  );
}
