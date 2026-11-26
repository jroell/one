import { ArchiveIcon, Clock3Icon } from "lucide-react";
import { useLocale } from "gt-react";

/**
 * Faint previews for the empty states, each drawn from what its own page holds, so three pages
 * with one template read as three designed states. All are decoration: the empty state hides them
 * from assistive technology.
 */

const ghostCard = "rounded-lg border border-(--settings-hairline) px-3 py-2.5";

/** A week of days with the weekdays marked: a schedule, not a list. */
function WeekStrip({ marked }: { readonly marked: ReadonlyArray<number> }) {
  const locale = useLocale();
  // 2024-01-01 is a Monday.
  const initials = Array.from({ length: 7 }, (_, day) =>
    new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 1 + day)),
    ),
  );
  return (
    <span className="flex gap-1">
      {initials.map((initial, day) => (
        <span
          // The week has seven fixed positions.
          // eslint-disable-next-line react/no-array-index-key
          key={day}
          className={
            marked.includes(day)
              ? "grid size-5 place-items-center rounded-md bg-foreground/12 text-2xs text-foreground"
              : "grid size-5 place-items-center rounded-md text-2xs text-(--settings-description)"
          }
        >
          {initial}
        </span>
      ))}
    </span>
  );
}

/** Scheduled tasks: a task with its week and the time of its next run. */
export function ScheduleGhost({
  tasks,
}: {
  readonly tasks: ReadonlyArray<{
    readonly title: string;
    readonly cadence: string;
    readonly next: string;
    readonly days: ReadonlyArray<number>;
  }>;
}) {
  return (
    <ul data-settings-empty-ghost="" className="flex flex-col gap-2">
      {tasks.map((task, index) => (
        <li
          key={task.title}
          className={`${ghostCard} flex flex-col gap-2`}
          style={{ opacity: 1 - index * 0.4 }}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="truncate text-sm text-foreground">{task.title}</span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-(--settings-description)">
              <Clock3Icon className="size-3.5" />
              {task.next}
            </span>
          </span>
          <WeekStrip marked={task.days} />
          <span className="truncate text-xs text-(--settings-description)">{task.cadence}</span>
        </li>
      ))}
    </ul>
  );
}

/** Archive: rows as the archive lists them, without the actions, so nothing looks clickable. */
export function ArchiveGhost({
  rows,
}: {
  readonly rows: ReadonlyArray<{ readonly title: string; readonly meta: string }>;
}) {
  return (
    <ul data-settings-empty-ghost="" className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <li
          key={row.title}
          className={`${ghostCard} flex items-center justify-between gap-3`}
          style={{ opacity: 1 - index * 0.4 }}
        >
          <span className="flex min-w-0 items-center gap-3">
            <ArchiveIcon className="size-4 shrink-0 text-(--settings-description)" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm text-foreground">{row.title}</span>
              <span className="truncate text-xs text-(--settings-description)">{row.meta}</span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Usage providers: a source with how much of its quota is used, as the usage page draws it. */
export function QuotaGhost({
  sources,
}: {
  readonly sources: ReadonlyArray<{
    readonly name: string;
    readonly window: string;
    readonly used: number;
  }>;
}) {
  return (
    <ul data-settings-empty-ghost="" className="flex flex-col gap-2">
      {sources.map((source, index) => (
        <li
          key={source.name}
          className={`${ghostCard} flex flex-col gap-2`}
          style={{ opacity: 1 - index * 0.4 }}
        >
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-foreground">{source.name}</span>
            <span className="shrink-0 text-xs text-(--settings-description) tabular-nums">
              {source.used}%
            </span>
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <span
              className="block h-full rounded-full bg-foreground/35"
              style={{ width: `${source.used}%` }}
            />
          </span>
          <span className="truncate text-xs text-(--settings-description)">{source.window}</span>
        </li>
      ))}
    </ul>
  );
}
