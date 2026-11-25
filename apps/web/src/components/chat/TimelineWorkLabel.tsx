import { SharedTooltipTrigger } from "../ui/shared-tooltip";
import { abbreviateHomePath, splitObjectPath, splitWorkLabel } from "./TimelineWorkLabel.logic";

/** Verb in prose, object in the mono face, with the directory truncating before the name. */
export function WorkLabelText(props: {
  readonly label: string;
  readonly objects: ReadonlyArray<string | null | undefined>;
}) {
  const parts = splitWorkLabel(props.label, props.objects);
  if (parts === null) return props.label;
  // A command is not a path: it keeps its slashes and truncates at the end.
  const { dir, base } = /\s/.test(parts.object)
    ? { dir: "", base: parts.object }
    : splitObjectPath(abbreviateHomePath(parts.object));
  return (
    <span className="flex min-w-0 items-baseline gap-1.5" data-one-work-label="">
      {parts.before.trim() ? (
        <span className="shrink-0" data-one-work-verb="">
          {parts.before.trim()}
        </span>
      ) : null}
      <SharedTooltipTrigger
        label={parts.object}
        render={<span className="flex min-w-0 items-baseline" data-one-work-object="" />}
      >
        {dir ? (
          <span className="min-w-0 truncate" data-one-work-object-dir="">
            {dir}
          </span>
        ) : null}
        <span className={dir ? "shrink-0" : "min-w-0 truncate"}>{base}</span>
      </SharedTooltipTrigger>
      {parts.after.trim() ? <span className="min-w-0 truncate">{parts.after.trim()}</span> : null}
    </span>
  );
}
