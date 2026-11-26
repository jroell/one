import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

/**
 * The one empty or unavailable state in Settings: a serif headline, one sentence that says why the
 * page is empty with a concrete example, one action that fixes it, and, when there is room, a faint
 * preview of what will appear. No icon tile. The look is in one-settings.css.
 */
export function SettingsEmptyState({
  icon,
  title,
  description,
  action,
  preview,
  className,
}: {
  /** A small glyph before the headline, for a state with no preview. */
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  /** Why the page is empty, and what would fill it. */
  readonly description: ReactNode;
  /** The one action that fixes it. A second action belongs in the page, not here. */
  readonly action?: ReactNode;
  /** What will appear here, drawn faintly and hidden from assistive technology. */
  readonly preview?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div data-settings-empty-card="" className="m-raised @container/empty">
      <div
        data-settings-empty=""
        className={cn(
          "grid min-h-48 items-center gap-6 p-6 sm:p-8 @min-[34rem]/empty:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]",
          className,
        )}
      >
        <div className="flex min-w-0 flex-col items-start gap-3">
          {icon && !preview ? (
            <span aria-hidden className="text-(--settings-description) [&_svg]:size-5">
              {icon}
            </span>
          ) : null}
          <h3 data-slot="empty-title">{title}</h3>
          <p data-slot="empty-description" className="max-w-[36ch] text-pretty">
            {description}
          </p>
          {action ? <div className="mt-1">{action}</div> : null}
        </div>
        {preview ? (
          <div
            aria-hidden
            data-settings-empty-preview=""
            className="hidden @min-[34rem]/empty:block"
          >
            {preview}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Rows as they will look once there is something to list, fading out, as a preview. */
export function EmptyGhostRows({
  rows,
}: {
  readonly rows: ReadonlyArray<{
    readonly icon: ReactNode;
    readonly title: string;
    readonly meta: string;
  }>;
}) {
  return (
    <ul data-settings-empty-ghost="" className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <li
          key={row.title}
          className="flex items-center gap-3 rounded-lg border border-(--settings-hairline) px-3 py-2.5"
          style={{ opacity: 1 - index * 0.35 }}
        >
          <span className="text-(--settings-description) [&_svg]:size-4">{row.icon}</span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm text-foreground">{row.title}</span>
            <span className="truncate text-xs text-(--settings-description)">{row.meta}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
