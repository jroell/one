import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib/utils";

/** Keeps `data-empty` on a section while its last child renders nothing. */
function trackEmpty(section: HTMLElement | null): (() => void) | undefined {
  if (section === null) return undefined;
  const update = () => {
    const last = section.lastElementChild;
    section.toggleAttribute(
      "data-empty",
      last instanceof HTMLDivElement && last.childNodes.length === 0,
    );
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(section, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}

export function ThreadDetailsSection({
  headingId,
  title,
  actions,
  separated = true,
  showHeading = true,
  children,
  ...props
}: Omit<ComponentProps<"section">, "className" | "style" | "title" | "aria-labelledby"> & {
  headingId: string;
  title: string;
  actions?: ReactNode;
  separated?: boolean;
  showHeading?: boolean;
}) {
  return (
    <section
      {...props}
      aria-labelledby={showHeading ? headingId : undefined}
      aria-label={showHeading ? undefined : title}
      // A row can still render nothing (a fresh draft quiets Git actions), so an empty section
      // collapses, and a divider only follows a section that has content. `data-empty` is kept in
      // step by `trackEmpty`: a `:has()` of the earlier sibling in front of `~` restyled the page.
      ref={trackEmpty}
      className={cn(
        "px-2 pt-2 pb-2.5 has-[>div:last-child:empty]:hidden",
        separated && "border-border/65 [section:not([data-empty])~&]:border-t",
      )}
    >
      <div
        className={cn(
          "mb-1 flex min-h-8 min-w-0 items-center justify-between gap-2 px-2.5",
          !showHeading && "hidden",
        )}
      >
        <h3
          id={headingId}
          className="min-w-0 truncate text-2xs font-medium text-muted-foreground select-none"
        >
          {title}
        </h3>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
