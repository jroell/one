import { useGT } from "gt-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const REDACTED_TEXT_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function redactedPlaceholder(value: string): string {
  let state = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }

  const nextChar = () => {
    state = Math.imul(state ^ (state >>> 13), 0x85ebca6b);
    state = Math.imul(state ^ (state >>> 16), 0xc2b2ae35);
    return REDACTED_TEXT_ALPHABET[Math.abs(state) % REDACTED_TEXT_ALPHABET.length] ?? "x";
  };

  return Array.from(value, (char) => {
    if (char === "@" || char === "." || char === "-" || char === "_") return char;
    return nextChar();
  }).join("");
}

export function RedactedSensitiveText(props: {
  readonly value: string | null | undefined;
  readonly ariaLabel: string;
  readonly revealTooltip: string;
  readonly hideTooltip: string;
  readonly className?: string;
}) {
  const gt = useGT();
  const [revealed, setRevealed] = useState(false);
  const value = props.value?.trim();

  if (!value) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.ariaLabel}
            aria-pressed={revealed}
            className={cn(
              "inline-flex min-w-0 cursor-pointer items-center gap-2 rounded-sm text-2xs leading-normal text-(--settings-description) transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              props.className,
            )}
            onClick={() => setRevealed((current) => !current)}
          >
            {revealed ? (
              <span className="min-w-0 truncate tabular-nums text-foreground">{value}</span>
            ) : (
              <span className="inline-flex h-5 items-center rounded-full bg-foreground/8 px-2 font-medium">
                {gt("Hidden", { $context: "a value kept out of sight until revealed" })}
              </span>
            )}
            <span className="shrink-0 underline-offset-2 hover:underline">
              {revealed ? gt("Hide") : gt("Show")}
            </span>
          </button>
        }
      />
      <TooltipPopup side="top">{revealed ? props.hideTooltip : props.revealTooltip}</TooltipPopup>
    </Tooltip>
  );
}
