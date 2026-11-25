import { resolveEventKeys } from "@t3tools/shared/keybindingMatching";
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
  // The page's one heading is the band's. The condensed copy in the top bar only repeats it.
  if (condensed) {
    return (
      <span aria-hidden data-one-page-title="condensed" className="truncate">
        {children}
      </span>
    );
  }
  return (
    <h1 data-one-page-title="" className="truncate">
      {children}
    </h1>
  );
}

/**
 * The page's own header band: the title at 30px with one line saying what the list holds, so
 * the 52px chrome row above it stays for the window's controls.
 */
export function ListPageBand({
  title,
  subtitle,
}: {
  readonly title: ReactNode;
  readonly subtitle: string | null;
}) {
  return (
    <div data-one-page-band="" className="flex flex-col gap-1.5 pt-6">
      <ListPageTitle>{title}</ListPageTitle>
      {/* Reserve the line while the list loads, so the toolbar does not drop when it arrives. */}
      <p data-one-page-subtitle="" className="min-h-5 text-sm">
        {subtitle}
      </p>
    </div>
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
      if (event.defaultPrevented || event.isComposing) return;
      // The same test Settings uses. Shift is allowed only where the layout types "/" with it
      // (German Shift+7); Shift on the physical Slash key types "?" or "," instead.
      const isSlash =
        resolveEventKeys(event).has("/") &&
        (event.key === "/" || !event.shiftKey) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey;
      if (!isSlash) return;
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
