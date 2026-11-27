import { T, useGT } from "gt-react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useRef, type ComponentProps } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import {
  serializeTableElementToCsv,
  serializeTableElementToHtml,
  serializeTableElementToMarkdown,
} from "../../markdown-clipboard";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { reportMarkdownActionFailure, type TableCopyFormat } from "./markdownActionFailure";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";

type TableTextFormat = Exclude<TableCopyFormat, "png">;

const TABLE_COPY_SERIALIZERS: Record<TableTextFormat, (table: Element) => string> = {
  markdown: serializeTableElementToMarkdown,
  csv: serializeTableElementToCsv,
  html: serializeTableElementToHtml,
};

// Loaded on first use; the clipboard write still starts inside the click.
const renderTablePng = (table: HTMLTableElement) =>
  import("./tablePng").then((module) => module.renderTablePng(table));

interface HastElementLike {
  readonly type?: string;
  readonly tagName?: string;
  readonly children?: ReadonlyArray<HastElementLike>;
}

/** The body rows and columns of a table, read from its markdown node; null when it has none. */
export function markdownTableShape(
  node: HastElementLike | undefined,
): { readonly rows: number; readonly columns: number } | null {
  const sections = node?.children?.filter((child) => child.tagName !== undefined) ?? [];
  const rows = sections
    .filter((section) => section.tagName === "tbody")
    .flatMap((section) => section.children ?? [])
    .filter((row) => row.tagName === "tr");
  const firstRow =
    sections
      .find((section) => section.tagName === "thead")
      ?.children?.find((row) => row.tagName === "tr") ?? rows[0];
  const columns = firstRow?.children?.filter((cell) => cell.tagName !== undefined).length ?? 0;
  return rows.length === 0 || columns === 0 ? null : { rows: rows.length, columns };
}

export function MarkdownTable({
  children,
  shape = null,
  ...props
}: ComponentProps<"table"> & {
  /** What the table holds, named in the Chat mode caption. */
  shape?: { readonly rows: number; readonly columns: number } | null;
}) {
  const gt = useGT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const {
    copyToClipboard,
    copyPngToClipboard,
    isCopied: copied,
  } = useCopyToClipboard<TableCopyFormat>({
    timeout: 1200,
    onError: (cause, format) =>
      reportMarkdownActionFailure({ operation: "copy-table", format }, cause),
  });
  const copyLabel = copied ? gt("Copied") : gt("Copy table");
  // Insecure origins (plain http over a LAN or tailnet) have no async clipboard for images.
  const canCopyPng =
    typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function";

  const handleCopy = (format: TableTextFormat) => {
    const table = containerRef.current?.querySelector("table");
    if (!table) return;
    const text = TABLE_COPY_SERIALIZERS[format](table);
    // Plain-text targets get the markup; rich targets (mail, docs, wikis) paste a real table.
    copyToClipboard(
      text,
      format,
      format === "html" ? { "text/html": `<meta charset="utf-8">${text}` } : undefined,
      { requireHtml: format === "html" },
    );
  };

  const handleCopyPng = () => {
    const table = containerRef.current?.querySelector("table");
    if (!table) return;
    copyPngToClipboard(() => renderTablePng(table), "png");
  };

  return (
    <div ref={containerRef} className="chat-markdown-table-container" data-one-table="">
      <div
        className="flex items-center justify-between ps-3 pe-1.5 pt-1.5 select-none"
        data-one-table-header=""
        data-thread-find-ignore=""
      >
        <span className="font-mono text-2xs" data-one-table-label="">
          <T>Table</T>
        </span>
        {shape ? (
          <span data-one-table-caption="">
            {gt(
              "{rows, plural, one {# row} other {# rows}} · {columns, plural, one {# column} other {# columns}}",
              { rows: shape.rows, columns: shape.columns },
            )}
          </span>
        ) : null}
        <Menu>
          <SharedTooltipTrigger
            render={
              <MenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={copyLabel}
                    data-one-copied={copied ? "" : undefined}
                  />
                }
              />
            }
            label={copyLabel}
          >
            {copied ? (
              <CheckIcon className="size-3" data-one-copy-check="" />
            ) : (
              <CopyIcon className="size-3" />
            )}
          </SharedTooltipTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => handleCopy("markdown")}>
              <T>Copy as Markdown</T>
            </MenuItem>
            <MenuItem onClick={() => handleCopy("csv")}>
              <T>Copy as CSV</T>
            </MenuItem>
            <MenuItem onClick={() => handleCopy("html")}>
              <T>Copy as HTML</T>
            </MenuItem>
            {canCopyPng ? (
              <MenuItem onClick={handleCopyPng}>
                <T>Copy as PNG</T>
              </MenuItem>
            ) : null}
          </MenuPopup>
        </Menu>
      </div>
      <ScrollArea radius="none" chainVerticalScroll scrollFade className="w-full max-w-full">
        <table {...props}>{children}</table>
      </ScrollArea>
    </div>
  );
}
