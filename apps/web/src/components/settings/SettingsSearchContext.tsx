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

export function SettingsSearchEmptyState() {
  const gt = useGT();
  const { query, setQuery, inputRef } = useSettingsSearchState();
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
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
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setQuery("");
          inputRef.current?.focus();
        }}
      >
        {gt("Clear search")}
      </Button>
    </div>
  );
}
