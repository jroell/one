import { createContext, use } from "react";

import type { SidebarThreadSummary } from "../../types";
import { ThreadSearchPullRequestNumber } from "../ThreadStatusIndicators";

/**
 * The text typed in the palette, for rows to read when they are drawn. Thread items are built once
 * and kept across keystrokes, so nothing in them can hold the query.
 */
export const PaletteQueryContext = createContext("");

export function PaletteThreadPullRequestNumber(props: {
  readonly thread: SidebarThreadSummary;
  readonly settled: boolean;
}) {
  const query = use(PaletteQueryContext);
  return (
    <ThreadSearchPullRequestNumber thread={props.thread} query={query} settled={props.settled} />
  );
}
