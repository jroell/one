import { createContext, use, type ReactNode } from "react";

const UsageControlsContext = createContext<ReactNode>(null);

/** Gives every view of the page the one control row, so each puts it under its own headline. */
export const UsageControlsProvider = UsageControlsContext.Provider;

/** The filters and the period: one calm row under the headline, at the same place on every tab. */
export function UsageControlsSlot() {
  const controls = use(UsageControlsContext);
  return controls === null ? null : <div className="usage-controls">{controls}</div>;
}
