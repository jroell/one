import { ArrowLeftIcon, ArrowRightIcon, ChartNoAxesColumnIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { T, useGT } from "gt-react";
import { memo, useEffect } from "react";
import { Link, useLocation, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";

import { useAtomValue } from "@effect/atom-react";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { isElectron as isDesktopApp } from "../../env";
import { formatShortcutLabel, shortcutLabelForCommand } from "../../keybindings";
import {
  navigateHistory,
  useCanNavigateHistory,
  type HistoryDirection,
} from "../../navigationHistory";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { cn } from "../../lib/utils";
import { useIssuesSupported, usePullRequestsSupported } from "../../state/environments";
import { OneGlyph } from "../../one/OneGlyph";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { readIssueListPreferences } from "../issue/issueListPreferences";
import { IssueGlyph } from "../issue/issuePresentation";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { observeResize } from "~/lib/observeResize";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const gt = useGT();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode,
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <div
      className={cn(
        "relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-2 pr-3",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] z-10 ml-[calc(var(--workspace-controls-left)+1px-env(safe-area-inset-left))] flex shrink-0 items-center md:hidden">
        <SidebarTrigger
          variant={backdropVariant ? "media-navigation" : "ghost"}
          className="relative top-auto translate-y-0"
          aria-label={gt("Toggle main sidebar")}
        />
      </div>
      <div className="relative z-10 flex h-8 min-w-0 flex-1 flex-wrap content-start items-center gap-x-2 overflow-hidden py-0.5">
        <div className="flex shrink-0 items-center gap-1">
          <SidebarBrand onBackdrop={backdropVariant !== null} />
          {isElectron ? (
            <div className="hidden items-center md:flex">
              <HistoryNavigationButton direction="back" onBackdrop={backdropVariant !== null} />
              <HistoryNavigationButton direction="forward" onBackdrop={backdropVariant !== null} />
            </div>
          ) : null}
        </div>
        {pillLabel ? (
          <div className="ml-1 flex h-7 items-center">
            <Badge data-environment-identification="pill" size="sm" variant="secondary">
              {pillLabel}
            </Badge>
          </div>
        ) : null}
      </div>
    </div>
  );
});

export function SidebarBrandWidthProbe({
  isElectron,
  onWidthChange,
}: {
  isElectron: boolean;
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) => {
    return observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });
  };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max border-r border-transparent pr-3"
      ref={observeWidth}
    >
      <div className="ml-[var(--workspace-titlebar-content-left)] flex gap-1">
        <SidebarBrandMark onBackdrop={false} />
        {isElectron ? <div className="w-[calc(2*var(--workspace-titlebar-control-size))]" /> : null}
      </div>
    </div>
  );
}

function HistoryNavigationButton({
  direction,
  onBackdrop,
}: {
  direction: HistoryDirection;
  onBackdrop: boolean;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const enabled = useCanNavigateHistory(direction);
  const gt = useGT();
  const label = direction === "back" ? gt("Go back") : gt("Go forward");
  const shortcutLabel = shortcutLabelForCommand(
    keybindings,
    direction === "back" ? "navigation.back" : "navigation.forward",
  );
  const Icon = direction === "back" ? ArrowLeftIcon : ArrowRightIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className={cn(
              "[-webkit-app-region:no-drag]",
              onBackdrop && "relative top-auto translate-y-0",
            )}
            disabled={!enabled}
            onClick={() => navigateHistory(direction)}
            size="icon-sm"
            variant={onBackdrop ? "media-navigation" : "ghost"}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {label}
        {shortcutLabel ? ` (${shortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  const gt = useGT();
  return (
    <Link
      aria-label={gt("One home")}
      className={cn(
        "one-mark-host relative z-10 ml-[var(--workspace-titlebar-content-left)] hidden h-7 w-fit min-w-0 shrink-0 items-center overflow-hidden rounded-md outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset md:flex",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      to="/"
    >
      <SidebarBrandMark onBackdrop={onBackdrop} />
    </Link>
  );
}

function SidebarBrandMark({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <OneGlyph size={16} data-one-brand-glyph="" data-on-backdrop={onBackdrop || undefined} />
      <span
        data-one-wordmark=""
        className={cn(
          "truncate [text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1",
          onBackdrop ? "text-white" : "text-foreground",
        )}
      >
        {"One"}
      </span>
    </span>
  );
}

// The desktop application menu owns this accelerator; it is not a keybinding command.
const DESKTOP_SETTINGS_SHORTCUT = {
  key: ",",
  modKey: true,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
} as const;

function SidebarUtilityItem({
  icon,
  label,
  shortcutLabel,
  active = false,
  onClick,
  onPreload,
}: {
  icon: ReactNode;
  label: string;
  shortcutLabel?: string | null;
  /** The page this icon opens is the one on screen. */
  active?: boolean;
  onClick: () => void;
  /** Loads what the click opens, so the first press does not wait for its code. */
  onPreload?: () => void;
}) {
  const gt = useGT();
  // The lit icon is the way out of its page, and it says so.
  const name = active ? gt("Back from {page}", { page: label }) : label;
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={name}
              aria-current={active ? "page" : undefined}
              isActive={active}
              onClick={onClick}
              onFocus={onPreload}
              onPointerEnter={onPreload}
              size="icon"
            >
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">
          {name}
          {shortcutLabel ? ` (${shortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const router = useRouter();
  const preloadSettings = () => void router.preloadRoute({ to: "/settings/general" });
  const preloadUsage = () => void router.preloadRoute({ to: "/usage" });
  // The two sheets' code loads once the app is idle after boot, and sooner on hover or focus.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the idle preload of the Settings and Usage route chunks once
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 2000));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => {
      void router.preloadRoute({ to: "/settings/general" });
      void router.preloadRoute({ to: "/usage" });
    });
    return () => cancel(handle);
  }, [router]);
  const navigateToMainApp = useNavigateToMainApp();
  const gt = useGT();
  const { isMobile, setOpenMobile } = useSidebar();
  const pathname = useLocation({ select: (location) => location.pathname });
  // The matched route, not the typed path, says which list is open: "/Issues" is the same page.
  const activePage = useRouterState({
    select: (state) =>
      state.matches.some((match) => match.routeId === "/_chat/pull-requests")
        ? "pull-requests"
        : state.matches.some((match) => match.routeId === "/_chat/issues")
          ? "issues"
          : null,
  });
  // The footer keeps its four icons on every page, with the open page's icon lit; clicking it
  // goes back. Pages with no icon of their own (a project, workflows) keep the Back button.
  const isOnUtilityPage = isSidebarUtilityPage(pathname) && activePage === null;
  const pullRequestsSupported = usePullRequestsSupported();
  const issuesSupported = useIssuesSupported();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const usageShortcutLabel = shortcutLabelForCommand(keybindings, "usage.open");
  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const handlePullRequestsClick = () => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  };
  const handleIssuesClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/issues", search: readIssueListPreferences() });
  };
  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  };

  const handleUsageClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  };

  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToMainApp();
  };

  return (
    <SidebarMenu className="flex-row items-center">
      {isOnUtilityPage ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>
              <T>Back</T>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <>
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label={gt("Settings")}
            shortcutLabel={isDesktopApp ? formatShortcutLabel(DESKTOP_SETTINGS_SHORTCUT) : null}
            onClick={handleSettingsClick}
            onPreload={preloadSettings}
          />
          {/* The open page keeps its icon, and so its exit, even if its capability goes away. */}
          {pullRequestsSupported || activePage === "pull-requests" ? (
            <SidebarUtilityItem
              icon={<PullRequestGlyph.pullRequest />}
              label={gt("Pull requests")}
              active={activePage === "pull-requests"}
              onClick={activePage === "pull-requests" ? handleBackClick : handlePullRequestsClick}
            />
          ) : null}
          {issuesSupported || activePage === "issues" ? (
            <SidebarUtilityItem
              icon={<IssueGlyph.issue />}
              label={gt("Issues", { $context: "sidebar link to the list of issues" })}
              active={activePage === "issues"}
              onClick={activePage === "issues" ? handleBackClick : handleIssuesClick}
            />
          ) : null}
          <SidebarUtilityItem
            icon={<ChartNoAxesColumnIcon />}
            label={gt("Usage")}
            shortcutLabel={usageShortcutLabel}
            onClick={handleUsageClick}
            onPreload={preloadUsage}
          />
        </>
      )}
      <SidebarThreadUndoNotice />
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter>
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
