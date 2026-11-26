import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { ProviderSettingsPanel } from "../components/settings/ProviderSettingsPanel";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";
import { useProviderInstanceRoute } from "../components/settings/useProviderInstanceRoute";

function SettingsProvidersRoute() {
  const { instanceId, onSelectInstance, returnFocusRow } = useProviderInstanceRoute();
  const { environment, scope } = useSettingsScope();
  const gt = useGT();
  if (!environment) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        {scope.kind === "environment"
          ? gt("Reconnect {label} to set up its providers.", { label: scope.label })
          : gt("Connect an environment to set up its providers.")}
      </p>
    );
  }
  return (
    <ProviderSettingsPanel
      environmentId={environment.environmentId}
      {...(instanceId ? { instanceId } : {})}
      // A provider is a page of its own: its address names it, so it can be linked and reloaded.
      onSelectInstance={onSelectInstance}
      {...(returnFocusRow ? { returnFocusRow } : {})}
      projectIds={
        scope.kind === "project" || scope.kind === "checkout"
          ? scope.members
              .filter((member) => member.environmentId === environment.environmentId)
              .map((member) => member.id)
          : []
      }
      scoped
    />
  );
}

export const Route = createFileRoute("/_chat/settings/providers")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    // Set by the Usage page to start this provider's sign-in once; the section removes it.
    ...(raw.action === "sign-in" ? { action: "sign-in" as const } : {}),
    // Set by an Ask One answer to open the dialog that adds a usage source once; the section removes it.
    ...(raw.action === "add-hub" || raw.action === "add-http-source" ? { action: raw.action } : {}),
    ...(typeof raw.instanceId === "string" && raw.instanceId.trim()
      ? { instanceId: ProviderInstanceId.make(raw.instanceId) }
      : {}),
  }),
  component: SettingsProvidersRoute,
});
