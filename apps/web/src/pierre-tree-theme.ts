import type { CSSProperties, FocusEvent, PointerEvent } from "react";

export const PIERRE_TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 0.75rem;
  }
  [data-truncate-content='visible'] { overflow: hidden; text-overflow: ellipsis; }
  [data-truncate-marker] { display: none; }
  button[data-type='item'], button[data-type='item']::before { border-radius: var(--radius-md); }
  svg[data-icon-name='t3-tree-icon-loading'] { opacity: 0.6; }
  @media (prefers-reduced-motion: no-preference) {
    svg[data-icon-name='t3-tree-icon-loading'] { animation: t3-tree-spin 1s linear infinite; }
  }
  @keyframes t3-tree-spin { to { transform: rotate(360deg); } }
`;

export function pierreTreeStyle(colorScheme: "light" | "dark"): CSSProperties {
  return {
    colorScheme,
    ["--trees-fg-override" as string]: "var(--contrast-foreground)",
    ["--trees-fg-muted-override" as string]: "var(--contrast-muted-foreground)",
    ["--trees-status-ignored-override" as string]: "var(--contrast-muted-foreground)",
  };
}

// Clipped labels are unreadable and the tree cannot scroll sideways, so a clipped row gets its full name as a native tooltip.
/** The path a tree row stands for, without the invisible suffix that separates a file from a folder. */
function pierreTreeRowPath(row: HTMLElement): string | null {
  const path = row.getAttribute("data-item-path")?.replaceAll("\u200b", "");
  return path ? path.replace(/\/$/, "") : null;
}

function pierreTreeRowOf(event: { nativeEvent: Event }): HTMLElement | undefined {
  return event.nativeEvent
    .composedPath()
    .find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && node.matches("button[data-type='item']"),
    );
}

/** A clipped row shows its whole path in a tooltip, since the folder tells siblings apart. */
export function titleClippedPierreTreeRow(event: PointerEvent<HTMLElement>) {
  const row = pierreTreeRowOf(event);
  if (!row) return;
  const clipped = Array.from(
    row.querySelectorAll<HTMLElement>("[data-truncate-content='visible']"),
  ).some((element) => element.scrollWidth > element.clientWidth);
  const path = pierreTreeRowPath(row);
  if (path && clipped) row.title = path;
  else row.removeAttribute("title");
}

/** A focused row is named by its whole path, so a screen reader hears the folder as well. */
export function namePierreTreeRowWithPath(event: FocusEvent<HTMLElement>) {
  const row = pierreTreeRowOf(event);
  const path = row ? pierreTreeRowPath(row) : null;
  if (row && path && row.getAttribute("aria-label") !== path) row.setAttribute("aria-label", path);
}
