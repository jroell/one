import { useGT } from "gt-react";
import { memo } from "react";
import { cn } from "~/lib/utils";

export function formatCompactDiffCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 999_500) {
    const k = value / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
  }
  if (value < 999_500_000) {
    const m = value / 1_000_000;
    return `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)}m`;
  }
  const b = value / 1_000_000_000;
  return `${b < 10 ? b.toFixed(1).replace(/\.0$/, "") : Math.round(b)}b`;
}

const BINARY_DIFF_EXTENSION =
  /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|heic|psd|pdf|zip|gz|tgz|tar|7z|rar|jar|woff2?|ttf|otf|eot|mp[34]|mov|webm|wav|ogg|flac|wasm|sqlite3?|db|bin|exe|dll|dylib|so|node|class|pyc|lockb)$/i;

/**
 * Git reports a binary file as zero added and zero removed lines, which reads as "no change".
 * A zero-line stat on a file type that cannot hold lines is a binary file.
 */
export function isLikelyBinaryDiffFile(
  path: string,
  additions: number,
  deletions: number,
): boolean {
  return additions === 0 && deletions === 0 && BINARY_DIFF_EXTENSION.test(path);
}

export const DiffStatLabel = memo(function DiffStatLabel(props: {
  additions: number;
  deletions: number;
  binary?: boolean;
  className?: string;
  layout?: "aligned" | "inline";
}) {
  const { additions, deletions, binary = false, className, layout = "aligned" } = props;
  const gt = useGT();
  if (binary) {
    return (
      <span
        data-one-diff-binary=""
        className={cn(
          "justify-self-end whitespace-nowrap font-mono text-muted-foreground",
          layout === "aligned" && "inline-block text-right",
          className,
        )}
      >
        {gt("Binary")}
      </span>
    );
  }
  return (
    <span
      role="group"
      aria-label={gt("{additions} additions, {deletions} deletions", { additions, deletions })}
      className={cn(
        layout === "inline"
          ? "inline-flex items-center gap-1 tabular-nums align-middle"
          : "inline-grid grid-cols-[4ch_4ch] gap-2 text-right tabular-nums align-middle",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "font-mono",
          additions === 0 ? "text-muted-foreground" : "text-diff-addition-foreground",
        )}
      >
        +{formatCompactDiffCount(additions)}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "font-mono",
          deletions === 0 ? "text-muted-foreground" : "text-diff-deletion-foreground",
        )}
      >
        -{formatCompactDiffCount(deletions)}
      </span>
    </span>
  );
});
