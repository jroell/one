import { msg } from "gt-react";

export const DEFAULT_COMPOSER_PLACEHOLDER = msg("Ask anything. @ files, $ skills, / commands");

/** Chat mode asks for a question, not a command; the @, $ and / features still work. */
export const CHAT_COMPOSER_PLACEHOLDER = msg("Ask a question, or pick up where you left off");
