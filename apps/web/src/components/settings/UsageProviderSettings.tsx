import type { EnvironmentId, UnifiedSettings } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { PlusIcon } from "lucide-react";
import { SettingsEmptyState } from "./SettingsEmptyState";

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { AddUsageLimitSourceDialog } from "./AddUsageLimitSourceDialog";
import { useSearchableSetting } from "./settingsSearch";
import { QuotaGhost } from "./EmptyGhosts";
import { ExplainControl } from "./explain/ExplainControl";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const CLI_PROXY_NAME = "CLI Proxy";

export function UsageProviderSettings({
  environmentId,
  environmentLabel,
  sources,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly sources: UnifiedSettings["usageLimitSources"];
  readonly readOnly: boolean;
}) {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [adding, setAdding] = useState<"cliproxy" | "http" | null>(null);
  // An address that names `?action=add-hub` or `add-http-source` opens that dialog once, then the
  // address is cleaned so a reload or the way back does not open it again.
  const navigate = useNavigate();
  const addIntent = useSearch({
    strict: false,
    select: (search: { readonly action?: string }) =>
      search.action === "add-hub"
        ? ("cliproxy" as const)
        : search.action === "add-http-source"
          ? ("http" as const)
          : null,
  });
  const [seenIntent, setSeenIntent] = useState<"cliproxy" | "http" | null>(null);
  if (addIntent !== seenIntent) {
    setSeenIntent(addIntent);
    if (addIntent !== null && !readOnly) setAdding(addIntent);
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- removes the one-time intent from the address once it has opened the dialog
  useEffect(() => {
    if (addIntent === null) return;
    void navigate({
      search: ((previous: { readonly action?: string }) => {
        const { action: _intent, ...rest } = previous;
        return rest;
      }) as never,
      replace: true,
      resetScroll: false,
    });
  }, [addIntent, navigate]);
  const entries = Object.entries(sources);

  return (
    <>
      <SettingsSection
        {...searchableSetting("usage-providers")}
        titleAction={<ExplainControl topic="usage-providers" variant="icon" />}
        headerAction={
          !readOnly ? (
            <div className="flex gap-2">
              <Button size="xs" variant="outline" onClick={() => setAdding("cliproxy")}>
                <PlusIcon className="size-3" aria-hidden />
                <T>Add hub</T>
              </Button>
              <Button size="xs" variant="outline" onClick={() => setAdding("http")}>
                <PlusIcon className="size-3" aria-hidden />
                <T>Add HTTP source</T>
              </Button>
            </div>
          ) : null
        }
      >
        {entries.length === 0 ? (
          <SettingsEmptyState
            className="min-h-40"
            title={gt("No usage sources configured")}
            description={gt(
              "See how much of your AI subscriptions is left when your accounts live on a server you run yourself, under Usage.",
            )}
            learnMore={<ExplainControl topic="usage-providers" />}
            preview={
              <QuotaGhost
                sources={[
                  { name: gt("Shared proxy"), window: gt("Resets in 3 hours"), used: 62 },
                  { name: gt("Team gateway"), window: gt("Resets Monday"), used: 31 },
                ]}
              />
            }
          />
        ) : (
          entries.map(([id, source]) => {
            const kindLabel = source.kind === "http" ? gt("HTTP quota source") : CLI_PROXY_NAME;
            const label = source.label?.trim() || source.url;
            return (
              <SettingsRow
                key={id}
                title={label}
                description={
                  <span className="break-all">
                    {source.enabled ? kindLabel : gt("{name} · Disabled", { name: kindLabel })}
                    {label !== source.url ? ` · ${source.url}` : ""}
                  </span>
                }
                control={
                  !readOnly ? (
                    <RemoveUsageProviderButton
                      label={label}
                      onConfirm={() => updateSettings({ usageLimitSources: { [id]: null } })}
                    />
                  ) : null
                }
              />
            );
          })
        )}
      </SettingsSection>
      {adding && !readOnly ? (
        <AddUsageLimitSourceDialog
          open
          kind={adding}
          onOpenChange={(open) => {
            if (!open) setAdding(null);
          }}
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          sources={sources}
        />
      ) : null}
    </>
  );
}

function RemoveUsageProviderButton({
  label,
  onConfirm,
}: {
  readonly label: string;
  readonly onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        <T>Remove</T>
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>
                Remove <Var>{label}</Var>?
              </T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>The saved connection and its credentials are removed from this environment.</T>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              <T>Remove</T>
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
