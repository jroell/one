import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { CSSProperties } from "react";

import { cn } from "../../lib/utils";

export interface UsageSwitchOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly title?: string | undefined;
}

/**
 * The page's segmented switches (period, metric, breakdown), in the Code/Chat switch's material:
 * one lit thumb that slides on the spring under the options. A toggle group, so every option
 * keeps its pressed state and arrow-key behavior.
 */
export function UsageSwitch<Value extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  readonly label: string;
  readonly value: Value;
  readonly options: readonly UsageSwitchOption<Value>[];
  readonly onChange: (value: Value) => void;
  readonly className?: string | undefined;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  return (
    <ToggleGroupPrimitive
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        const picked = options.find((option) => option.value === next[0]);
        if (picked) onChange(picked.value);
      }}
      className={cn("one-mode-switch usage-switch [-webkit-app-region:no-drag]", className)}
      style={{ "--usage-i": index, "--usage-n": options.length } as CSSProperties}
    >
      <span aria-hidden className="one-mode-switch-thumb usage-switch-thumb" />
      {options.map((option) => (
        <TogglePrimitive
          key={option.value}
          value={option.value}
          title={option.title}
          className="one-mode-switch-option usage-switch-option"
        >
          {option.label}
        </TogglePrimitive>
      ))}
    </ToggleGroupPrimitive>
  );
}
