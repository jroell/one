import { useRouter } from "@tanstack/react-router";
import { T, useGT, Var } from "gt-react";
import { ArrowLeftIcon } from "lucide-react";

import { clearGuidedReturn, useGuidedReturn } from "./guidedReturn";
import { useWorkspaceMode } from "./workspaceMode";

/**
 * In Chat mode, a quiet way back to the page a guided conversation was opened from, such as a
 * Settings page. It goes away once it has been used.
 */
export function GuidedBackLink({ threadKey }: { readonly threadKey: string }) {
  const gt = useGT();
  const router = useRouter();
  const target = useGuidedReturn(threadKey);
  const chatMode = useWorkspaceMode() === "chat";
  if (!chatMode || target === null) return null;
  return (
    <button
      type="button"
      data-guided-back=""
      aria-label={gt("Back to {label}", { label: target.label })}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [-webkit-app-region:no-drag]"
      onClick={() => {
        clearGuidedReturn(threadKey);
        void router.navigate({ href: target.href });
      }}
    >
      <ArrowLeftIcon aria-hidden className="size-3.5" />
      <span>
        <T>
          Back to <Var>{target.label}</Var>
        </T>
      </span>
    </button>
  );
}
