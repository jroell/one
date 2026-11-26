import { msg } from "gt-react";

export const DEFAULT_COMPOSER_PLACEHOLDER = msg("Ask anything. @ files, $ skills, / commands");

/** Chat mode invites a thought, not a command; the @, $ and / features still work. */
export const CHAT_COMPOSER_PLACEHOLDER = msg("Ask anything, or talk it through");
