import { SearchIcon } from "lucide-react";

import { Input, type InputProps } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";

/**
 * The search field every list shares: a leading icon, a hairline underneath that becomes the
 * focus edge, and an optional keycap at the end. The look lives in one-ui.css.
 */
function SearchField({
  shortcut,
  ...props
}: Omit<InputProps, "className" | "size" | "unstyled" | "nativeInput"> & {
  /** The key that focuses the field, drawn as a keycap. */
  shortcut?: string;
}) {
  return (
    <label className="block min-w-0 shrink-0 cursor-text">
      <div
        className="relative border-b border-border/70 pb-1.5 transition-colors"
        data-slot="search-field"
      >
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-2 left-0 size-4 shrink-0"
        />
        <Input
          {...props}
          className="rounded-none bg-transparent text-sm [&_input]:h-7 [&_input]:ps-6 [&_input]:font-sans [&_input]:leading-7"
          size="sm"
          unstyled
        />
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </div>
    </label>
  );
}

export { SearchField };
