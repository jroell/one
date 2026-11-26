import { useGT } from "gt-react";

import { Badge } from "../ui/badge";
import type { ProviderStatusKey } from "./providerStatus";

/**
 * The one set of states a Settings row can be in, as chips: Ready, Needs attention, Failed, Off and
 * Coming soon, Desktop only, plus In use for the device or route a list is using now and Connecting while it
 * is not yet known. The line under the name says why.
 */
export type SettingsStatus =
  | "ready"
  | "attention"
  | "failed"
  | "off"
  | "soon"
  | "connecting"
  | "inUse"
  | "desktopOnly";

const VARIANTS = {
  ready: "success",
  attention: "warning",
  failed: "error",
  off: "secondary",
  soon: "outline",
  connecting: "secondary",
  inUse: "secondary",
  desktopOnly: "outline",
} as const;

export function SettingsStatusChip({
  status,
  className,
}: {
  readonly status: SettingsStatus;
  readonly className?: string;
}) {
  const gt = useGT();
  const label = {
    ready: gt("Ready", { $context: "status chip: it works" }),
    attention: gt("Needs attention"),
    failed: gt("Failed"),
    off: gt("Off", { $context: "status chip: switched off" }),
    soon: gt("Coming soon"),
    connecting: gt("Connecting…"),
    inUse: gt("In use", { $context: "status chip: this is the one being used now" }),
    desktopOnly: gt("Desktop only"),
  }[status];
  return (
    <Badge
      variant={VARIANTS[status]}
      dot={status !== "soon" && status !== "desktopOnly"}
      data-settings-status={status}
      {...(className === undefined ? {} : { className })}
    >
      {label}
    </Badge>
  );
}

/** The chip for a provider's state; a provider whose state is not yet known has none. */
export function providerStatusChip(key: ProviderStatusKey): SettingsStatus | null {
  switch (key) {
    case "ready":
      return "ready";
    case "warning":
      return "attention";
    case "error":
      return "failed";
    case "disabled":
      return "off";
    case "neutral":
      return null;
  }
}
