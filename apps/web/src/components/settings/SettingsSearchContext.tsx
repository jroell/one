import { useLocation } from "@tanstack/react-router";
import { T, useGT, useMessages, Var } from "gt-react";
import { SearchXIcon } from "lucide-react";
import { createContext, useContext, useRef, useState, type ReactNode, type RefObject } from "react";

import { Button } from "../ui/button";
import { searchSettings } from "./settingsSearch";
import { useAvailableSettingsSearchItems } from "./useAvailableSettingsSearchItems";

interface SettingsSearchState {
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly inputRef: RefObject<HTMLInputElement | null>;
}

const SettingsSearchContext = createContext<SettingsSearchState | null>(null);

/** Shares the settings search text between the nav's field and the page it sits beside. */
export function SettingsSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <SettingsSearchContext value={{ query, setQuery, inputRef }}>{children}</SettingsSearchContext>
  );
}

export function useSettingsSearchState(): SettingsSearchState {
  const shared = useContext(SettingsSearchContext);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  return shared ?? { query, setQuery, inputRef };
}

/** True while the search text matches nothing, so the page beside the nav has nothing to show. */
export function useSettingsSearchHasNoResults(): boolean {
  const m = useMessages();
  const { query } = useSettingsSearchState();
  const items = useAvailableSettingsSearchItems();
  return query.trim().length > 0 && searchSettings(query, items, m).length === 0;
}

/**
 * A query that matches nothing makes the page behind it inert, so landing on another page (the
 * command palette, a link) would leave that page unusable. Drops such a query when the location
 * changes; a query that still has results stays.
 */
export function useClearNoMatchSearchOnNavigation(hasNoResults: boolean): void {
  const { setQuery } = useSettingsSearchState();
  const place = useLocation({ select: (location) => `${location.pathname}${location.hash}` });
  const [seenPlace, setSeenPlace] = useState(place);
  if (seenPlace !== place) {
    setSeenPlace(place);
    if (hasNoResults) setQuery("");
  }
}

export function SettingsSearchEmptyState() {
  const gt = useGT();
  const { query, setQuery, inputRef } = useSettingsSearchState();
  const clearSearch = () => {
    setQuery("");
    inputRef.current?.focus();
  };
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center"
      onKeyDown={(event) => {
        // The first Escape clears the search, like the search field; the next one closes Settings.
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        clearSearch();
      }}
    >
      <SearchXIcon aria-hidden className="size-6 text-muted-foreground" />
      <div role="status" className="flex max-w-sm flex-col gap-1">
        <p className="text-sm font-medium text-foreground wrap-anywhere">
          <T>
            No settings match “<Var>{query.trim()}</Var>”
          </T>
        </p>
        <p className="text-xs text-muted-foreground">
          <T>Check the spelling or try a shorter word.</T>
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={clearSearch}>
        {gt("Clear search")}
      </Button>
    </div>
  );
}
