import { resolveEnvironmentMachineKind, type EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ChevronRightIcon, FolderPlusIcon, LayersIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { cn } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useEnvironments, type EnvironmentPresentation } from "../../state/environments";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { displayPath } from "./displayPath";
import { ITEM_ROW_CLASSNAME } from "./itemRows";
import { SettingsEmptyState } from "./SettingsEmptyState";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useSettingsPathname } from "./useSettingsPathname";
import type { SettingsScopeSearch } from "./settingsScope";
import {
  projectScopeMenuGroups,
  selectProjectAxis,
  settingsScopeEnvironmentAddress,
  settingsScopeEnvironmentLabels,
  settingsScopeProjectMachines,
} from "./settingsScopeAxis";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";

interface ScopeChoice {
  label: string;
  secondary?: string;
  icon: ReactNode;
  search: SettingsScopeSearch;
}

export function SettingsScopeNotice({
  children,
  target,
  targetId,
  eligibleEnvironmentIds,
  inline = false,
  quiet = false,
  withAddProject = false,
}: {
  children: string;
  /** Keeps the message for assistive tech only, when the page already says it on screen. */
  quiet?: boolean;
  /** On the project list: an Add project action, and an empty state when there is no project. */
  withAddProject?: boolean;
  /** Renders inside a section instead of as its own page. */
  inline?: boolean;
  target: "environment" | "all" | "project" | "checkout";
  targetId?: string;
  eligibleEnvironmentIds?: readonly EnvironmentId[];
}) {
  const gt = useGT();
  const { selectScope, search, groups } = useSettingsScope();
  const navigate = useNavigate({ from: "/settings" });
  const pathname = useSettingsPathname();
  const { environments } = useEnvironments();
  const environmentIcon = (environment: EnvironmentPresentation | undefined) =>
    environment ? (
      <EnvironmentMachineIcon
        aria-hidden
        kind={resolveEnvironmentMachineKind(environment.serverConfig)}
        className="size-4 shrink-0 text-muted-foreground"
      />
    ) : null;
  const choiceGroups =
    target === "checkout"
      ? groups.filter((group) => !search.project || group.projectKey === search.project)
      : [null];
  const projectGroups = projectScopeMenuGroups(groups, search);
  // The scratch space is where chats with no project work. It is a project for the app and not one
  // the person added, so a list holding only it is still empty.
  const isScratchGroup = (group: SidebarProjectSnapshot) =>
    group.memberProjects.length > 0 &&
    group.memberProjects.every((member) =>
      isScratchProject(
        member,
        environments.find((entry) => entry.environmentId === member.environmentId)?.serverConfig
          ?.scratchWorkspaceRoot,
      ),
    );
  const renderChoices = (group: SidebarProjectSnapshot | null) => {
    const choices: ScopeChoice[] = group
      ? group.memberProjects.map((member) => {
          const environment = environments.find(
            (entry) => entry.environmentId === member.environmentId,
          );
          const { primary, secondary } = environment
            ? settingsScopeEnvironmentLabels(environment, environments)
            : {
                primary: member.environmentLabel ?? gt("Environment"),
                secondary: member.environmentId,
              };
          return {
            label: primary,
            secondary: [secondary, displayPath(member.workspaceRoot)].filter(Boolean).join(" · "),
            icon: environmentIcon(environment),
            search: {
              project: group.projectKey,
              machine: member.environmentId,
              checkout: member.physicalProjectKey,
            },
          };
        })
      : target === "project"
        ? projectGroups.map((group) => {
            const scratch = isScratchGroup(group);
            const member = group.memberProjects[0];
            const machine = (() => {
              const environment = environments.find(
                (entry) => entry.environmentId === member?.environmentId,
              );
              return environment
                ? settingsScopeEnvironmentLabels(environment, environments).primary
                : (member?.environmentLabel ?? gt("this computer"));
            })();
            return {
              label: scratch ? gt("Scratch space on {machine}", { machine }) : group.displayName,
              secondary: [
                ...(scratch ? [gt("For chats without a project")] : []),
                ...(group.archived ? [gt("Archived", { $context: "project state" })] : []),
                ...(projectGroups.some(
                  (other) =>
                    other.projectKey !== group.projectKey &&
                    other.displayName === group.displayName,
                )
                  ? settingsScopeProjectMachines(group, environments)
                  : []),
                displayPath(group.workspaceRoot),
              ].join(" · "),
              icon: <ProjectFavicon project={group} className="size-4 shrink-0" />,
              search: selectProjectAxis(search, group.projectKey),
            };
          })
        : target === "environment"
          ? environments
              .filter(
                (entry) =>
                  eligibleEnvironmentIds === undefined ||
                  eligibleEnvironmentIds.includes(entry.environmentId),
              )
              .map((entry) => {
                const { primary, secondary } = settingsScopeEnvironmentLabels(entry, environments);
                return {
                  label: primary,
                  secondary: secondary || settingsScopeEnvironmentAddress(entry),
                  icon: environmentIcon(entry),
                  search: { machine: entry.environmentId },
                };
              })
          : [
              {
                label: gt("Open all environments"),
                icon: <LayersIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />,
                search: {},
              },
            ];
    return choices.map((choice) => (
      <button
        key={JSON.stringify(choice.search)}
        type="button"
        data-settings-choice=""
        className={cn(
          ITEM_ROW_CLASSNAME,
          "flex w-full min-w-0 cursor-pointer items-center gap-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
        onClick={() => {
          if (targetId)
            void navigate({
              to: pathname,
              search: () => ({
                project: undefined,
                machine: undefined,
                checkout: undefined,
                ...choice.search,
              }),
              hash: targetId,
            });
          else selectScope(choice.search);
        }}
      >
        {choice.icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{choice.label}</span>
          {choice.secondary ? (
            <SharedTooltipTrigger
              render={<span className="block truncate text-xs text-muted-foreground" />}
              label={choice.secondary}
            >
              {choice.secondary}
            </SharedTooltipTrigger>
          ) : null}
        </span>
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
    ));
  };
  const addProject = (
    <Button size="sm" variant="outline" onClick={() => openCommandPalette({ open: "add-project" })}>
      <PlusIcon />
      <T>Add project</T>
    </Button>
  );
  if (withAddProject && projectGroups.every(isScratchGroup)) {
    const empty = (
      <SettingsEmptyState
        icon={<FolderPlusIcon />}
        title={gt("No projects yet")}
        description={gt(
          "A project is a folder with your code. Add one to start a thread in it, such as the repository you are working on.",
        )}
        action={
          <Button onClick={() => openCommandPalette({ open: "add-project" })}>
            <PlusIcon />
            <T>Add project</T>
          </Button>
        }
      />
    );
    const body =
      projectGroups.length === 0 ? (
        empty
      ) : (
        <div className="space-y-4">
          {empty}
          <SettingsSection title={gt("Scratch space")}>{renderChoices(null)}</SettingsSection>
        </div>
      );
    return inline ? body : <SettingsPageContainer>{body}</SettingsPageContainer>;
  }
  const notice = (
    <div className="space-y-3">
      <p
        role="status"
        className={cn("px-3 text-sm text-muted-foreground sm:px-4", quiet && "sr-only")}
      >
        {children}
      </p>
      <div className="space-y-4">
        {withAddProject ? (
          <SettingsSection title={gt("Your projects")} headerAction={addProject}>
            {renderChoices(null)}
          </SettingsSection>
        ) : null}
        {withAddProject
          ? null
          : choiceGroups.map((group) =>
              group?.displayName ? (
                <SettingsSection key={group.projectKey} title={group.displayName}>
                  {renderChoices(group)}
                </SettingsSection>
              ) : (
                <SettingsGroup key={group?.projectKey ?? target}>
                  {renderChoices(group)}
                </SettingsGroup>
              ),
            )}
      </div>
    </div>
  );
  return inline ? notice : <SettingsPageContainer>{notice}</SettingsPageContainer>;
}
