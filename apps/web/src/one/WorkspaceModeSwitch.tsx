import { useGT } from "gt-react";
import { CodeXmlIcon, MessagesSquareIcon } from "lucide-react";
import type { KeyboardEvent } from "react";

import { cn } from "~/lib/utils";
import {
  setWorkspaceMode,
  toggleWorkspaceMode,
  useWorkspaceMode,
  type WorkspaceMode,
} from "./workspaceMode";

/** Two-way switch between the coding workspace and the chat layout. */
export function WorkspaceModeSwitch({ className }: { readonly className?: string }) {
  const gt = useGT();
  const mode = useWorkspaceMode();
  const options: ReadonlyArray<{ mode: WorkspaceMode; label: string; icon: typeof CodeXmlIcon }> = [
    {
      mode: "code",
      label: gt("Code", { $context: "workspace mode for coding" }),
      icon: CodeXmlIcon,
    },
    {
      mode: "chat",
      label: gt("Chat", { $context: "workspace mode for conversation" }),
      icon: MessagesSquareIcon,
    },
  ];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = toggleWorkspaceMode();
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={gt("Workspace mode")}
      data-one-mode-switch={mode}
      className={cn("one-mode-switch [-webkit-app-region:no-drag]", className)}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true" className="one-mode-switch-thumb" />
      {options.map((option) => {
        const selected = option.mode === mode;
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            tabIndex={selected ? 0 : -1}
            data-mode={option.mode}
            className="one-mode-switch-option"
            onClick={() => setWorkspaceMode(option.mode, { transition: true })}
          >
            <option.icon aria-hidden="true" className="size-3.5" />
            <span className="one-mode-switch-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
