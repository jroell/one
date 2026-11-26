import type { EnvironmentId } from "@t3tools/contracts";

import { readEnvironment } from "~/state/environments";

/** Whether the environment's server reads the app's hidden notes on a message. */
export function acceptsAppNotes(environmentId: EnvironmentId): boolean {
  return (
    readEnvironment(environmentId)?.serverConfig?.environment.capabilities.messageAgentContext ===
    true
  );
}
