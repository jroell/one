import { makeWindow } from "@t3tools/shared/usageFormat";

import { prefetchUsage } from "../../state/usage";
import { readUsagePagePreferences } from "./usagePagePreferences";

/**
 * Starts the figures the Usage page will ask for first. After boot, a person who keeps Usage on
 * Limits is not asked for cost figures they may never open; hovering or focusing the button always is.
 * The past-24-hours view is keyed by the minute, so there is nothing to ready for it.
 */
export function prefetchDefaultUsage(when: "idle" | "intent"): void {
  const preferences = readUsagePagePreferences();
  if (preferences.windowDays === 1) return;
  if (when === "idle" && preferences.metric === "limits") return;
  prefetchUsage(makeWindow(preferences.windowDays, undefined, "day"));
}
