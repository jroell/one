import { createContext } from "react";

import type { ComposerBridgeScope } from "./composerSendBridge";

/**
 * Which composer the guided replies, quiz buttons and follow-ups in this part of the tree send
 * through. The main view uses "main"; the Ask One side sheet provides "sheet".
 */
export const GuidedBridgeScopeContext = createContext<ComposerBridgeScope>("main");
