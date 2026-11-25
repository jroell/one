import { SearchIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Input, type InputProps } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";

/**
 * The frame every search field in the app shares: a leading icon, a hairline underneath that
 * becomes the focus edge, and an optional keycap at the end. The look lives in one-ui.css under
 * `[data-slot="search-field"]`. `SearchField` is the text input version; a menu, a combobox or a
 * palette puts its own input inside the frame.
 */
function SearchFieldFrame({
  children,
  icon,
  inset = "none",
  shortcut,
}: {
  children: ReactNode;
  /** Replaces the magnifier, for example with a spinner while results load. */
  icon?: ReactNode;
  /** The padding a floating surface puts around its search row. */
  inset?: "none" | "menu" | "combobox";
  /** The key that focuses the field, drawn as a keycap. */
  shortcut?: string;
}) {
  return (
    <label
      className={cn(
        "block min-w-0 shrink-0 cursor-text",
        inset === "menu" && "px-2 pt-1.5 pb-1",
        inset === "combobox" && "px-3 pt-2.5",
      )}
    >
      <div
        className="relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors"
        data-slot="search-field"
      >
        {icon ?? (
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1.5 left-0 size-4 shrink-0"
          />
        )}
        {children}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </div>
    </label>
  );
}

function SearchField({
  shortcut,
  ...props
}: Omit<InputProps, "className" | "size" | "unstyled" | "nativeInput"> & {
  /** The key that focuses the field, drawn as a keycap. */
  shortcut?: string;
}) {
  return (
    <SearchFieldFrame {...(shortcut ? { shortcut } : {})}>
      <Input
        {...props}
        className="rounded-none bg-transparent text-sm [&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5"
        size="sm"
        unstyled
      />
    </SearchFieldFrame>
  );
}

export { SearchField, SearchFieldFrame };
