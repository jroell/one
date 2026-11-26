import { useGT } from "gt-react";
import { ImageOffIcon } from "lucide-react";

import { Button } from "~/components/ui/button";

/**
 * A picture that would not load, in Chat mode: one 64px row where it was going to be, with the
 * alt text as a serif caption, what went wrong beneath it, and a way to try again. It stays on
 * the page, but takes no more room than a line of the answer.
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
        <span className="one-chat-image-failure-body">
          {caption.length > 0 ? (
            <span className="one-chat-image-failure-caption">{caption}</span>
          ) : null}
          <span className="one-chat-image-failure-text" data-thread-find-ignore>
            {detail ?? gt("The picture did not load")}
          </span>
        </span>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {gt("Retry")}
          </Button>
        ) : null}
      </span>
    </span>
  );
}
