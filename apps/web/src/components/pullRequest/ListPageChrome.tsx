import { useEffect, type ReactNode, type RefObject } from "react";

import { isEditableFocused } from "../../lib/editableFocus";

/**
 * The title both list pages (pull requests and issues) set in the opening's serif. It shrinks
 * to 17px in the condensed top bar, where it shares the row with the filters.
 */
export function ListPageTitle({
  children,
  condensed = false,
}: {
  readonly children: ReactNode;
  readonly condensed?: boolean;
}) {
  return (
    <h1 data-one-page-title={condensed ? "condensed" : ""} className="truncate">
      {children}
    </h1>
  );
}

/**
 * "/" moves focus to the page's search field, as it does in Settings. Neither list page focuses
 * the field on arrival: a ring on an empty field reads as an error before anyone has typed.
 */
export function useSlashFocusesSearch(pageRef: RefObject<HTMLElement | null>) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener focuses the page's search input on "/"
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "/") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableFocused(event.target)) return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="menu"], [role="listbox"]')
      )
        return;
      const page = pageRef.current;
      if (!page || page.closest("[inert]")) return;
      const input = page.querySelector<HTMLInputElement>('input[role="searchbox"]');
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pageRef]);
}
