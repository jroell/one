import { useGT } from "gt-react";
import { ImageOffIcon } from "lucide-react";

import { Button } from "~/components/ui/button";

/**
 * A picture that would not load, in Chat mode: a 16:9 frame where it was going to be, the alt
 * text set under it as a caption, and a way to try again. A failed picture is part of the page,
 * so it keeps the page's shape instead of collapsing to a chip.
 */
export function ChatImageFailure({
  alt,
  detail,
  copyMarkdown,
  onRetry,
}: {
  readonly alt: string;
  readonly detail?: string | undefined;
  readonly copyMarkdown?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
}) {
  const gt = useGT();
  const caption = alt.trim();
  return (
    <span
      className="one-chat-image-failure"
      data-chat-image-failure=""
      data-markdown-copy={copyMarkdown}
      role="alert"
    >
      <span className="one-chat-image-failure-frame">
        <ImageOffIcon aria-hidden className="one-chat-image-failure-icon" />
        <span className="one-chat-image-failure-text" data-thread-find-ignore>
          {detail ?? gt("The picture did not load")}
        </span>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {gt("Retry")}
          </Button>
        ) : null}
      </span>
      {caption.length > 0 ? (
        <span className="one-chat-image-failure-caption">{caption}</span>
      ) : null}
    </span>
  );
}
