import { useGT } from "gt-react";
import { msg } from "gt-react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";

/** Copies a terminal command, for text that tells the person to run it. */
export function CopyCommandButton({ command }: { readonly command: string }) {
  const gt = useGT();
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "command",
      unavailableMessage: msg("Clipboard API is unavailable while copying the command."),
      failureMessage: msg("Failed to copy the command to the clipboard."),
    },
    timeout: 1_500,
  });
  return (
    <Button variant="outline" size="sm" onClick={() => copyToClipboard(command)}>
      {isCopied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      <span aria-live="polite">{isCopied ? gt("Copied") : gt("Copy command")}</span>
    </Button>
  );
}
