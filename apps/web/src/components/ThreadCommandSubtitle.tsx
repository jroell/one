import type { ProviderDriverKind } from "@t3tools/contracts";
import { T } from "gt-react";
import { createContext, use } from "react";
import { FolderGit2Icon, FolderIcon, GitBranchIcon } from "lucide-react";
import { ProjectFavicon, type ProjectFaviconProject } from "./ProjectFavicon";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { cn } from "~/lib/utils";

import { MiddleTruncate } from "./ui/middle-truncate";

/**
 * The context a list names once beside its heading. A row whose own context matches it leaves that
 * part out, so a column of identical "project, machine, branch" lines does not repeat.
 */
export const SharedThreadContext = createContext<string | null>(null);

export type ThreadCommandSubtitleVariant =
  | "favicon-workspace-harness"
  | "favicon-workspace"
  | "favicon-branch-harness";

const THREAD_COMMAND_SUBTITLE_VARIANT: ThreadCommandSubtitleVariant = "favicon-workspace-harness";

export const COMMAND_PALETTE_META_ICON_CLASS = "size-3 shrink-0 text-muted-foreground/70";

export function CommandPaletteMetaDot() {
  return <span className="shrink-0 text-muted-foreground/50">·</span>;
}

function WorkspaceIcon(props: { variant: ThreadCommandSubtitleVariant; isWorktree: boolean }) {
  if (props.isWorktree) {
    return <FolderGit2Icon className={COMMAND_PALETTE_META_ICON_CLASS} aria-hidden />;
  }
  if (props.variant === "favicon-branch-harness") {
    return <GitBranchIcon className={COMMAND_PALETTE_META_ICON_CLASS} aria-hidden />;
  }
  return <FolderIcon className={COMMAND_PALETTE_META_ICON_CLASS} aria-hidden />;
}

export function ThreadCommandSubtitle(props: {
  project: ProjectFaviconProject | null;
  projectTitle: string | null;
  environmentLabel?: string | null;
  branch: string | null;
  worktreePath: string | null;
  isCurrent: boolean;
  driverKind?: ProviderDriverKind | null;
  providerDisplayName?: string | null;
  acpRegistryAgentId?: string | undefined;
  acpRegistryIconUrl?: string | undefined;
  variant?: ThreadCommandSubtitleVariant;
  contextKey?: string;
  className?: string;
}) {
  const sharedContext = use(SharedThreadContext);
  const contextShared = sharedContext !== null && sharedContext === props.contextKey;
  const variant = props.variant ?? THREAD_COMMAND_SUBTITLE_VARIANT;
  const isWorktree = props.worktreePath != null && props.worktreePath.trim().length > 0;
  const showHarness =
    variant !== "favicon-workspace" && props.driverKind != null && props.providerDisplayName;

  const projectLabel = props.projectTitle?.trim() || null;
  const branchLabel = props.branch?.trim() || null;
  const visibleContext = !contextShared && Boolean(projectLabel || branchLabel);

  if (!projectLabel && !branchLabel && !props.isCurrent && !showHarness) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-muted-foreground/70",
        props.className,
      )}
    >
      {contextShared ? (
        // The list's heading says it once for the eye; each option keeps it for assistive tech, so
        // it is still read after the heading has scrolled away.
        <span className="sr-only">
          {[projectLabel, props.environmentLabel, branchLabel].filter(Boolean).join(", ")}
        </span>
      ) : (
        <>
          {projectLabel ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              {props.project ? (
                <ProjectFavicon project={props.project} className="size-3 shrink-0" />
              ) : null}
              <span className="min-w-0 truncate">{projectLabel}</span>
              {props.environmentLabel ? (
                <>
                  <CommandPaletteMetaDot />
                  <span className="shrink-0">{props.environmentLabel}</span>
                </>
              ) : null}
            </span>
          ) : null}

          {branchLabel ? (
            <>
              {projectLabel ? <CommandPaletteMetaDot /> : null}
              <span className="inline-flex min-w-0 items-center gap-1">
                <WorkspaceIcon variant={variant} isWorktree={isWorktree} />
                <MiddleTruncate value={branchLabel} />
              </span>
            </>
          ) : null}
        </>
      )}

      {showHarness && props.driverKind ? (
        <>
          {visibleContext ? <CommandPaletteMetaDot /> : null}
          <ProviderInstanceIcon
            driverKind={props.driverKind}
            displayName={props.providerDisplayName ?? props.driverKind}
            acpRegistryAgentId={props.acpRegistryAgentId}
            acpRegistryIconUrl={props.acpRegistryIconUrl}
            iconClassName="size-3 shrink-0 opacity-70"
          />
        </>
      ) : null}

      {props.isCurrent ? (
        <>
          {visibleContext || showHarness ? <CommandPaletteMetaDot /> : null}
          <span className="shrink-0">
            <T>Current thread</T>
          </span>
        </>
      ) : null}
    </span>
  );
}
