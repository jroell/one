import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { useContext } from "react";

import { useNewThreadHandler } from "../../../hooks/useHandleNewThread";
import { createScratchProjectActions } from "../../../hooks/useScratchProject";
import { useEnvironments, usePrimaryEnvironmentId } from "../../../state/environments";
import type { MessageResolver } from "../../../i18n/messages";
import { useEnvironmentSettings } from "../../../hooks/useSettings";
import { providersIgnoringCheckedAtAtom } from "../../../state/server";
import { buildSetupSnapshot } from "./explainSnapshot";
import type { SetupSnapshot } from "./explainTypes";

/** The person's setup for one environment, read from the provider list and its settings. */
export function useSetupSnapshot(
  environmentId: EnvironmentId,
  resolve: MessageResolver,
  otherMachineViewed = false,
): SetupSnapshot {
  const providers = useAtomValue(providersIgnoringCheckedAtAtom(environmentId));
  const settings = useEnvironmentSettings(environmentId);
  return buildSetupSnapshot({ providers, settings, resolve, otherMachineViewed });
}

/**
 * The environment a guided conversation opens on: the same choice the conversation makes, because
 * it is the same function. The facts must describe this machine, whichever one Settings shows.
 */
export function useConversationEnvironmentId(): EnvironmentId | null {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const registry = useContext(RegistryContext);
  const handleNewThread = useNewThreadHandler();
  return createScratchProjectActions({
    environments: () => environments,
    primaryEnvironmentId: () => primaryEnvironmentId,
    registry,
    handleNewThread,
  }).scratchEnvironmentId(null);
}
