import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import type {
  EnvironmentId,
  ProviderInstanceConfig,
  ProviderInstanceId,
  ServerSettings,
} from "@t3tools/contracts";
import { useGT } from "gt-react";

import { usePersistEnvironmentProviderInstanceMutation } from "~/hooks/useSettings";
import { m as resolveNow } from "../../i18n/messages";
import { toastManager } from "../ui/toast";
import { buildProviderInstanceUpdatePatch } from "./SettingsPanels.logic";

/**
 * Saves one provider instance the way the Providers page does, toasting a failure in words. The
 * page and the Explain popover's "Turn on" share it, so both write the same patch.
 */
export function useProviderInstancePersister(
  environmentId: EnvironmentId,
  settings: Pick<ServerSettings, "providerInstances">,
) {
  const gt = useGT();
  const persistProviderInstance = usePersistEnvironmentProviderInstanceMutation(environmentId);
  return async (
    instanceId: ProviderInstanceId,
    next: ProviderInstanceConfig,
    textGenerationModelSelection?: Parameters<
      typeof buildProviderInstanceUpdatePatch
    >[0]["textGenerationModelSelection"],
  ): Promise<boolean> => {
    const { providerInstances: _providerInstances, ...patch } = buildProviderInstanceUpdatePatch({
      settings,
      instanceId,
      instance: next,
      textGenerationModelSelection,
    });
    const result = await persistProviderInstance(
      { operation: "upsert", instanceId, instance: next },
      patch,
    );
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not update provider instance"),
        description:
          error instanceof Error
            ? (thrownErrorMessage(error, resolveNow) ?? error.message)
            : gt("The settings update failed."),
      });
    }
    return result._tag !== "Failure";
  };
}
