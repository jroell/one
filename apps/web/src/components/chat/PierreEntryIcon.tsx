import { FileIcon, FolderIcon } from "lucide-react";
import { memo } from "react";

import { ensurePierreIconSprite, resolvePierreIconForEntry } from "../../pierre-icons";
import { cn } from "~/lib/utils";

// Every icon references the one shared sprite, so it is in the document before any renders.
ensurePierreIconSprite();

/**
 * A file or folder icon in one bone tone, whatever the language: colour is kept for status, so
 * the icon carries no colour of its own and the sprite draws in `currentColor`. A caller that
 * needs another tone sets it with a text colour class.
 */
export const PierreEntryIcon = memo(function PierreEntryIcon(props: {
  pathValue: string;
  kind: "file" | "directory";
  mimeType?: string | undefined;
  /** Unused: the icon no longer depends on the theme. Callers may stop passing it. */
  theme?: "light" | "dark";
  className?: string;
}) {
  const icon = resolvePierreIconForEntry(props.pathValue, props.kind, props.mimeType);

  if (!icon) {
    return props.kind === "directory" ? (
      <FolderIcon className={cn("size-4 text-icon-muted", props.className)} />
    ) : (
      <FileIcon className={cn("size-4 text-icon-muted", props.className)} />
    );
  }

  return (
    <svg
      aria-hidden="true"
      data-pierre-icon={icon.name}
      data-icon-token={icon.token}
      className={cn("size-4 shrink-0 text-icon-muted", props.className)}
      viewBox="0 0 16 16"
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
});
