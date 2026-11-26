import { ExplainControl } from "./explain/ExplainControl";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { ChevronDownIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { useState, type ReactNode } from "react";
import type {
  SourceControlDiscoveryResult,
  SourceControlProviderAuth,
  SourceControlProviderDiscoveryItem,
  VcsDriverKind,
  VcsDiscoveryItem,
} from "@t3tools/contracts";
import { useSettingsScope } from "./SettingsScopeContext";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useWaitedLongerThan } from "./useWaitedLongerThan";
import type { EnvironmentId } from "@t3tools/contracts";
import { serverEnvironment } from "../../state/server";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { SettingsEmptyState } from "./SettingsEmptyState";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { T, useGT, useMessages, Var } from "gt-react";
import type { MessageResolver } from "../../i18n/messages";

import { GitIcon, JujutsuIcon, type Icon } from "../Icons";
import { IssueTrackerSettings } from "./IssueTrackerSettings";
import { SourceControlHostSettings } from "./SourceControlHostSettings";
import { SourceControlAccountSettings } from "./SourceControlAccountSettings";
import { SourceControlAppSignInSettings } from "./SourceControlAppSignInSettings";
import { SourceControlTokenSettings } from "./SourceControlTokenSettings";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { SettingsStatusChip, type SettingsStatus } from "./settingsStatus";
import { SourceControlWritingSettingsSection } from "./SourceControlWritingSettings";
import {
  SettingsPageContainer,
  SettingsSearchTarget,
  SettingsSection,
  useSettingsSearchTargetId,
} from "./settingsLayout";
import { useSearchableSetting, sourceControlHostSettingsSearchId } from "./settingsSearch";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { sourceControlInstallHintText } from "@t3tools/client-runtime/contract-labels";
import { isSourceControlProviderOffered } from "@t3tools/client-runtime/operations/projects";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { sourceControlIcon } from "~/sourceControlPresentation";

const EMPTY_DISCOVERY_RESULT: SourceControlDiscoveryResult = {
  versionControlSystems: [],
  sourceControlProviders: [],
};

const VCS_ICONS: Partial<Record<VcsDriverKind, Icon>> = {
  git: GitIcon,
  jj: JujutsuIcon,
};

function optionLabel(value: Option.Option<string>): string | null {
  return Option.getOrNull(value);
}

function isProviderDiscoveryItem(
  item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem,
): item is SourceControlProviderDiscoveryItem {
  return "auth" in item;
}

function isVcsNotReady(item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem): boolean {
  return !isProviderDiscoveryItem(item) && !item.implemented;
}

function RedactedAccount(props: { readonly account: string | null }) {
  const gt = useGT();
  return (
    <RedactedSensitiveText
      value={props.account}
      ariaLabel={gt("Toggle source control account visibility")}
      revealTooltip={gt("Click to reveal account")}
      hideTooltip={gt("Click to hide account")}
    />
  );
}

function itemStatusDot(item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem): string {
  if (isVcsNotReady(item)) return "bg-muted-foreground/35";
  if (isProviderDiscoveryItem(item)) {
    return item.status === "available" && item.auth.status === "authenticated"
      ? "bg-success"
      : "bg-muted-foreground/35";
  }
  if (item.status !== "available") return "bg-warning";
  return "bg-success";
}

function sourceControlItemIcon(
  item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem,
): ReactNode {
  const host = isProviderDiscoveryItem(item) ? sourceControlClients.find(item.kind) : undefined;
  const Icon = isProviderDiscoveryItem(item)
    ? host && sourceControlIcon(host)
    : VCS_ICONS[item.kind];
  return Icon ? <Icon className="size-4.5 text-foreground/80" aria-hidden /> : null;
}

function SourceControlItemMark({
  item,
}: {
  readonly item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem;
}) {
  const icon = sourceControlItemIcon(item);

  if (!icon) {
    return <span className={cn("size-2 shrink-0 rounded-full", itemStatusDot(item))} aria-hidden />;
  }

  return <span className="inline-flex size-5 shrink-0 items-center justify-center">{icon}</span>;
}

/** What the row's tool is doing, as one chip from the shared set beside its name. */
function itemStatus(
  item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem,
): SettingsStatus | null {
  if (isVcsNotReady(item)) return "soon";
  if (item.status !== "available") return "attention";
  if (!isProviderDiscoveryItem(item)) return "ready";
  if (item.auth.status === "authenticated") return "ready";
  return item.auth.status === "unauthenticated" ? "attention" : null;
}

function itemSummary({
  item,
  auth,
  authAccount,
  resolve,
}: {
  readonly item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem;
  readonly auth: SourceControlProviderAuth | null;
  readonly authAccount: string | null;
  readonly resolve: MessageResolver;
}) {
  const installHint = sourceControlInstallHintText(item.installHint, resolve);
  if (isVcsNotReady(item)) {
    return (
      <span>
        <T>
          Support for <Var>{item.label}</Var> is coming soon.
        </T>
      </span>
    );
  }

  if (item.status !== "available") {
    return (
      <span>
        <T>
          Not available on this server: <Var>{installHint}</Var>
        </T>
      </span>
    );
  }

  if (auth) {
    if (auth.status === "authenticated") {
      const authDetail = optionLabel(auth.detail);
      return (
        <>
          {authAccount ? (
            <span>
              <T>
                Authenticated as{" "}
                <Var>
                  <RedactedAccount account={authAccount} />
                </Var>
              </T>
            </span>
          ) : (
            <span>
              <T>Authenticated</T>
            </span>
          )}
          {authDetail ? <span>· {authDetail}</span> : null}
        </>
      );
    }

    if (!item.executable && auth.status === "unauthenticated") {
      return (
        <span>
          <T>
            Available. <Var>{installHint}</Var>
          </T>
        </span>
      );
    }

    if (auth.status === "unauthenticated" && auth.accounts?.some((entry) => entry.authenticated)) {
      return (
        <span>
          {optionLabel(auth.detail) ?? (
            <T>
              Every <Var>{item.label}</Var> host is turned off.
            </T>
          )}
        </span>
      );
    }

    if (auth.status === "unauthenticated") {
      return (
        <span>
          <T>
            <Var>{item.label}</Var> is not authenticated on this server. Sign in or configure
            credentials using the{" "}
            <code className="rounded bg-muted px-1 py-px text-2xs">
              <Var>{item.executable}</Var>
            </code>{" "}
            tool on the server host to enable change request features.
          </T>
        </span>
      );
    }
    const authDetail = optionLabel(auth.detail);
    return (
      <span>
        <T>
          Could not verify <Var>{item.label}</Var>. <Var>{authDetail ?? installHint}</Var>
        </T>
      </span>
    );
  }

  return null;
}

export function DiscoveryItemRow({
  item,
  offered,
  children,
}: {
  readonly item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem;
  /** A provider's switch chooses whether the project pickers offer it; a VCS switch only reports. */
  readonly offered?: {
    readonly checked: boolean;
    readonly disabled: boolean;
    readonly onChange: (checked: boolean) => void;
  };
  readonly children?: ReactNode;
}) {
  const messages = useMessages();
  const gt = useGT();
  const version = optionLabel(item.version);
  const auth = isProviderDiscoveryItem(item) ? item.auth : null;
  const authAccount = auth ? optionLabel(auth.account) : null;
  const status = itemStatus(item);
  const summary = itemSummary({ item, auth, authAccount, resolve: messages });
  const [isExpanded, setIsExpanded] = useState(false);
  const hasDetails = children !== undefined;
  const searchTargetId = useSettingsSearchTargetId();
  const [seenSearchTargetId, setSeenSearchTargetId] = useState<string | null>(null);
  const targetsThisRow = searchTargetId === sourceControlHostSettingsSearchId(item.kind);
  if (targetsThisRow && !isExpanded && seenSearchTargetId !== searchTargetId) {
    setIsExpanded(true);
  }
  if (seenSearchTargetId !== searchTargetId) setSeenSearchTargetId(searchTargetId);

  return (
    <div className={cn("first:rounded-t-xl last:rounded-b-xl transition-colors hover:bg-muted/20")}>
      <div className="px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SourceControlItemMark item={item} />
              <span className="truncate text-sm font-medium text-foreground">{item.label}</span>
              {version ? (
                <span className="text-xs tabular-nums text-(--settings-description)">
                  {version}
                </span>
              ) : null}
              {status ? <SettingsStatusChip status={status} /> : null}
            </div>
            {summary ? (
              <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs leading-normal text-(--settings-description)">
                {summary}
              </p>
            ) : null}
          </div>
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {hasDetails ? (
              <Button
                size="icon-xs"
                variant="ghost-muted"
                onClick={() => setIsExpanded((open) => !open)}
                aria-expanded={isExpanded}
                aria-label={gt("Toggle {label} details", { label: item.label })}
              >
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform", isExpanded && "rotate-180")}
                />
              </Button>
            ) : null}
            {offered ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Switch
                      checked={offered.checked}
                      disabled={offered.disabled}
                      onCheckedChange={offered.onChange}
                      aria-label={gt("Offer {label} when adding or publishing a project", {
                        label: item.label,
                      })}
                    />
                  }
                />
                <TooltipPopup side="top">
                  <T>Offer when adding or publishing a project</T>
                </TooltipPopup>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </div>

      {hasDetails ? (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleContent>
            <div className="px-3 pb-4 pt-1 sm:px-4">{children}</div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

interface PendingDiscoveryItem {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
}

/** The tools this page asks about, named while the server checks which are installed. */
export function SourceControlPendingSection({
  title,
  titleAction,
  headerAction,
  waiting,
  items,
}: {
  readonly title: string;
  readonly titleAction?: ReactNode;
  readonly headerAction?: ReactNode;
  /** Says what the page is waiting for, and what to do when it takes too long. */
  readonly waiting?: ReactNode;
  readonly items: ReadonlyArray<PendingDiscoveryItem>;
}) {
  const gt = useGT();
  return (
    <SettingsSection title={title} titleAction={titleAction} headerAction={headerAction}>
      {waiting ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-xs text-(--settings-description) sm:px-4"
        >
          {waiting}
        </div>
      ) : null}
      {items.map((item) => (
        <div key={item.key} className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <span className="inline-flex size-5 shrink-0 items-center justify-center">
              {item.icon}
            </span>
            <span className="truncate">{item.label}</span>
          </span>
          {/* One quiet mark per tool, and only after 250 ms: never a column of "Checking…". */}
          <span
            role="status"
            className="settings-late inline-flex size-5 shrink-0 items-center justify-center"
          >
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-(--settings-description) motion-safe:animate-pulse"
            />
            <span className="sr-only">{gt("Checking")}</span>
          </span>
        </div>
      ))}
    </SettingsSection>
  );
}

function EmptySourceControlDiscovery({
  error,
  isPending,
  onScan,
}: {
  readonly error: string | null;
  readonly isPending: boolean;
  readonly onScan: () => void;
}) {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const hasError = error !== null;

  return (
    <SettingsSection id={searchableSetting("source-control").id} title={gt("Server environment")}>
      <SettingsEmptyState
        icon={<PullRequestGlyph.pullRequest />}
        title={hasError ? gt("Could not scan the server environment") : gt("Nothing detected yet")}
        description={
          hasError
            ? error
            : gt(
                "Install Git on the server, add optional hosting integrations or credentials your workspace needs, then rescan.",
              )
        }
        action={
          <Button size="sm" variant="outline" onClick={onScan} disabled={isPending}>
            <RefreshIcon size="sm" refreshing={isPending} />
            {hasError ? <T>Retry</T> : <T>Scan</T>}
          </Button>
        }
      />
    </SettingsSection>
  );
}

/** Starts the environment scan ahead of the page and holds the result for a minute. */
export function prefetchSourceControlDiscovery(environmentId: EnvironmentId): void {
  const release = appAtomRegistry.mount(
    sourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
  window.setTimeout(release, 60_000);
}

export function SourceControlSettingsPanel() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const { scope, environment, connectedEnvironments } = useSettingsScope();

  const environmentId =
    environment?.connection.phase === "connected" ? environment.environmentId : null;
  const aggregate = scope.environmentIds.length !== 1 && connectedEnvironments.length > 1;
  const environmentSuffix = aggregate && environment ? ` · ${environment.label}` : "";
  const discovery = useEnvironmentQuery(
    environmentId === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId,
          input: {},
        }),
    useMessages(),
  );
  const result = discovery.data ?? EMPTY_DISCOVERY_RESULT;
  const hasVersionControlSystems = result.versionControlSystems.length > 0;
  const hasDiscoveryItems = hasVersionControlSystems || result.sourceControlProviders.length > 0;
  const isInitialScanPending = discovery.isPending && discovery.data === null;
  const scanIsSlow = useWaitedLongerThan(isInitialScanPending, 8000);
  const handleScan = () => {
    discovery.refresh();
  };
  // A CLI login on the server host changes nothing the client reads, so returning to the window
  // asks again. Discovery runs every hosting CLI, too costly for a timer nobody asked for.
  useLiveRefresh(
    () => {
      if (!discovery.isPending) discovery.refresh();
    },
    {
      enabled: environmentId !== null,
      key: `source-control-discovery:${environmentId}`,
      intervalMs: null,
    },
  );
  const offeredProviders = environment?.serverConfig?.settings.offeredSourceControlProviders;
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save source control providers",
  });
  const canUpdateSettings = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(environmentId),
  );
  const hostSettingsPanel = (item: SourceControlProviderDiscoveryItem) => {
    const definition = sourceControlClients.find(item.kind);
    if (!definition?.settings || environmentId === null) return undefined;
    const { credentials } = definition;
    if (credentials) {
      return (
        <SettingsSearchTarget id={sourceControlHostSettingsSearchId(item.kind)}>
          <div className="grid gap-6">
            {credentials.appSignIn && item.appSignIn === true ? (
              <SourceControlAppSignInSettings
                key={`sign-in-${environmentId}`}
                environmentId={environmentId}
                definition={definition}
                appSignIn={credentials.appSignIn}
                account={Option.getOrNull(item.auth.account)}
                onChanged={handleScan}
              />
            ) : null}
            {credentials.appSignIn && item.appSignIn === true ? (
              <div className="flex items-center gap-3 text-2xs text-muted-foreground">
                <span aria-hidden className="h-px flex-1 bg-border" />
                <T>Or use your own credentials</T>
                <span aria-hidden className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <SourceControlTokenSettings
              key={`token-${environmentId}`}
              environmentId={environmentId}
              definition={definition}
              credentials={credentials}
              onSaved={handleScan}
            />
            {item.status === "available" ? (
              <SourceControlAccountSettings
                key={environmentId}
                environmentId={environmentId}
                definition={definition}
                credentials={credentials}
                auth={item.auth}
                onSaved={handleScan}
              />
            ) : null}
          </div>
        </SettingsSearchTarget>
      );
    }
    return (
      <SettingsSearchTarget id={sourceControlHostSettingsSearchId(item.kind)}>
        <SourceControlHostSettings
          key={environmentId}
          environmentId={environmentId}
          definition={{ ...definition, settings: definition.settings }}
          onSaved={handleScan}
        />
      </SettingsSearchTarget>
    );
  };
  const scanButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            onClick={handleScan}
            disabled={discovery.isPending}
            aria-label={gt("Rescan server environment")}
          >
            <RefreshIcon refreshing={discovery.isPending} />
          </Button>
        }
      />
      <TooltipPopup side="top">
        <T>Rescan Git and hosting integrations</T>
      </TooltipPopup>
    </Tooltip>
  );

  return (
    <SettingsPageContainer>
      <ProjectDefaultsSettings category="source-control" />
      {environmentId === null ? (
        <SettingsSection
          id={searchableSetting("source-control").id}
          title={gt("Server environment")}
        >
          <p className="px-4 py-3 text-sm text-muted-foreground">
            <T>
              Connect an environment to inspect its version control tools and hosting integrations.
            </T>
          </p>
        </SettingsSection>
      ) : isInitialScanPending ? (
        <>
          <SourceControlPendingSection
            items={[
              { key: "git", label: gt("Git"), icon: <GitIcon className="size-4.5" aria-hidden /> },
              {
                key: "jj",
                label: gt("Jujutsu"),
                icon: <JujutsuIcon className="size-4.5" aria-hidden />,
              },
            ]}
            title={`${gt("Version control")}${environmentSuffix}`}
            headerAction={scanButton}
            waiting={
              scanIsSlow ? (
                <>
                  <span>
                    <T>Still checking. A hosting tool on this machine is slow to answer.</T>
                  </span>
                  <Button size="xs" variant="outline" onClick={handleScan}>
                    <T>Retry</T>
                  </Button>
                </>
              ) : undefined
            }
          />
          <SourceControlPendingSection
            title={gt("Source control providers")}
            titleAction={<ExplainControl topic="source-control-providers" variant="icon" />}
            items={sourceControlClients.definitions.map((definition) => {
              const Icon = sourceControlIcon(definition);
              return {
                key: definition.kind,
                label: definition.label,
                icon: Icon ? <Icon className="size-4.5" aria-hidden /> : null,
              };
            })}
          />
        </>
      ) : hasDiscoveryItems ? (
        <>
          {hasVersionControlSystems ? (
            <SettingsSection
              id={searchableSetting("source-control").id}
              title={`${gt("Version control")}${environmentSuffix}`}
              headerAction={scanButton}
            >
              {result.versionControlSystems.map((item) => (
                <DiscoveryItemRow key={`vcs:${item.kind}`} item={item} />
              ))}
            </SettingsSection>
          ) : null}

          {result.sourceControlProviders.length > 0 ? (
            <SettingsSection
              id={hasVersionControlSystems ? undefined : searchableSetting("source-control").id}
              title={
                hasVersionControlSystems
                  ? gt("Source control providers")
                  : `${gt("Source control providers")}${environmentSuffix}`
              }
              titleAction={<ExplainControl topic="source-control-providers" variant="icon" />}
              headerAction={hasVersionControlSystems ? null : scanButton}
            >
              {result.sourceControlProviders.map((item) => (
                <DiscoveryItemRow
                  key={`provider:${item.kind}`}
                  item={item}
                  offered={{
                    checked: isSourceControlProviderOffered(offeredProviders, item.kind),
                    disabled: !canUpdateSettings,
                    onChange: (checked) =>
                      void updateSettings({
                        environmentId,
                        input: {
                          patch: { offeredSourceControlProviders: { [item.kind]: checked } },
                        },
                      }),
                  }}
                >
                  {hostSettingsPanel(item)}
                </DiscoveryItemRow>
              ))}
            </SettingsSection>
          ) : null}
        </>
      ) : (
        <EmptySourceControlDiscovery
          error={discovery.error}
          isPending={discovery.isPending}
          onScan={handleScan}
        />
      )}
      {environmentId === null ? null : (
        <IssueTrackerSettings key={environmentId} environmentId={environmentId} />
      )}

      <SourceControlWritingSettingsSection />
    </SettingsPageContainer>
  );
}
