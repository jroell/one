import {
  type ChatAttachment,
  type ChatFileAttachment,
  type GuestMessageAttribution,
  type OrchestrationMessageContext,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type OrchestrationV2IdleCompaction,
  type OrchestrationV2UserMessageInputIntent,
  ScheduledTaskId,
} from "@t3tools/contracts";
import {
  isAttachmentOnlyBootstrapPrompt,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";
import { filePreviewKind } from "@t3tools/shared/filePreview";
import { imageMimeType } from "@t3tools/shared/image";
import { videoMimeType } from "@t3tools/shared/video";
import * as DateTime from "effect/DateTime";
import { msg } from "gt-i18n";

/** The working row while T3 Code's own compaction runs. */
export const IDLE_COMPACTING_LABELS = {
  beforeCacheExpires: msg("Compacting before the cache expires…"),
  onReturn: msg("Compacting…"),
} satisfies Record<OrchestrationV2IdleCompaction, string>;

/** Leads the finished compaction's token counts, in place of "Context compacted". */
export const IDLE_COMPACTION_TITLES = {
  beforeCacheExpires: msg("Auto-compacted before cache expiry"),
  onReturn: msg("Context compacted before sending"),
} satisfies Record<OrchestrationV2IdleCompaction, string>;

const LEGACY_INSTRUCTIONS_OPEN = "<one-instructions>";
const LEGACY_INSTRUCTIONS_CLOSE = "</one-instructions>";
/**
 * Messages made before this moment may hold the app's instructions inside their text, between
 * tags, written by an earlier build. From this moment the app sends them in
 * `context.agentContext`, so text made after it is always the person's own, tags and all.
 */
export const LEGACY_INSTRUCTIONS_UNTIL = "2026-11-27T00:00:00.000Z";

/** The quiz request as it was first sent, with its whole format in the visible text (English). */
const LEGACY_QUIZ_REQUEST =
  /^(Quiz me on what you just explained\.) Ask three questions\. Reply with only a fenced code block labelled quiz that holds JSON in this shape: [\s\S]*$/;

const isoOf = (value: unknown): string | undefined =>
  typeof value === "string"
    ? value
    : DateTime.isDateTime(value)
      ? DateTime.formatIso(value)
      : undefined;

/**
 * What the person wrote in a message made before `LEGACY_INSTRUCTIONS_UNTIL`, with the
 * instructions an earlier build put in its text left out. A newer message, or one with no date, is
 * returned as it is: text that merely looks like the tags is the person's.
 */
export function legacyVisibleText(message: {
  readonly text: string;
  readonly createdAt?: unknown;
}): string {
  const text = message.text;
  const createdAt = isoOf(message.createdAt);
  if (createdAt === undefined || !(createdAt < LEGACY_INSTRUCTIONS_UNTIL)) return text;
  const legacy = LEGACY_QUIZ_REQUEST.exec(text);
  if (legacy !== null) return legacy[1]!;
  const start = text.indexOf(LEGACY_INSTRUCTIONS_OPEN);
  if (start < 0) return text;
  const end = text.indexOf(LEGACY_INSTRUCTIONS_CLOSE, start);
  if (end < 0) return text;
  return `${text.slice(0, start).trimEnd()}${text.slice(end + LEGACY_INSTRUCTIONS_CLOSE.length)}`.trim();
}

const LEGACY_AUTOMATION_PREFIX = /^\[Triggered by schedule task: [^\r\n]+\]\r?\n\r?\n/;
const LEGACY_AUTOMATION_MESSAGE_ID = /^scheduled-task-message:(.+):\d+:(?:scheduled|manual)$/;

export function resolveUserMessageFileCards(message: {
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly context?: OrchestrationMessageContext | undefined;
}): ReadonlyArray<ChatFileAttachment> | null {
  const files = message.attachments.filter(
    (attachment): attachment is ChatFileAttachment =>
      attachment.type === "file" &&
      imageMimeType(attachment) === null &&
      videoMimeType(attachment) === null &&
      filePreviewKind(attachment) !== "audio",
  );
  if (files.length === 0 || files.length !== message.attachments.length) return null;
  const fileIds = new Set(files.map((file) => file.id));
  const remaining = replaceComposerContextReferences(message.text, (reference) => {
    const record = message.context?.records.find((item) => item.contextId === reference.contextId);
    return reference.kind === "file" &&
      record?.kind === "file" &&
      "attachmentId" in record &&
      fileIds.has(record.attachmentId)
      ? ""
      : reference.label || reference.kind;
  });
  return remaining.trim() === "" ? files : null;
}

export function resolveUserMessagePresentation(message: {
  readonly id?: string;
  readonly role: string;
  readonly text: string;
  readonly createdBy?: OrchestrationV2Actor;
  readonly creationSource?: OrchestrationV2CreationSource;
  readonly scheduledTaskId?: ScheduledTaskId | undefined;
  readonly context?: { readonly guest?: GuestMessageAttribution | undefined } | undefined;
  /** When it was made, as an ISO string or a date; read only to tell an old message from a new one. */
  readonly createdAt?: unknown;
}): {
  readonly text: string;
  readonly attribution: "automation" | "agent" | "t3code" | "guest" | null;
  readonly scheduledTaskId: ScheduledTaskId | undefined;
  /** Set when `attribution` is "guest". */
  readonly guestName?: string;
} {
  if (message.role !== "user") {
    return { text: message.text, attribution: null, scheduledTaskId: undefined };
  }
  // The stored text names the guest for the agent; people see the guest's own words.
  const guest = message.context?.guest;
  if (guest !== undefined) {
    return {
      text: guest.text,
      attribution: "guest",
      scheduledTaskId: undefined,
      guestName: guest.name,
    };
  }
  if (message.scheduledTaskId !== undefined) {
    return {
      text: message.text,
      attribution: "automation",
      scheduledTaskId: message.scheduledTaskId,
    };
  }
  const legacyPrefix = LEGACY_AUTOMATION_PREFIX.exec(message.text);
  const legacyTaskId = legacyPrefix
    ? LEGACY_AUTOMATION_MESSAGE_ID.exec(message.id ?? "")?.[1]
    : undefined;
  if (legacyPrefix !== null && (legacyTaskId !== undefined || message.createdBy === "agent")) {
    return {
      text: message.text.slice(legacyPrefix[0].length),
      attribution: "automation",
      scheduledTaskId: legacyTaskId === undefined ? undefined : ScheduledTaskId.make(legacyTaskId),
    };
  }
  return {
    // The agent needs words to start a turn; people sent only the attachments.
    text: isAttachmentOnlyBootstrapPrompt(message.text) ? "" : legacyVisibleText(message),
    attribution:
      message.createdBy !== "agent"
        ? null
        : message.creationSource === "server"
          ? "t3code"
          : "agent",
    scheduledTaskId: undefined,
  };
}

type GroupableUserMessage = Parameters<typeof resolveUserMessagePresentation>[0] & {
  readonly inputIntent?: OrchestrationV2UserMessageInputIntent;
};

export function resolveUserMessageGrouping(
  message: GroupableUserMessage | undefined,
  previous: GroupableUserMessage | undefined,
  next: GroupableUserMessage | undefined,
) {
  const isOwnMessage = (value: GroupableUserMessage | undefined) =>
    value?.role === "user" && resolveUserMessagePresentation(value).attribution === null;
  const isSteer = (value: GroupableUserMessage | undefined) =>
    value?.inputIntent === "steer" || value?.inputIntent === "promoted_queued_to_steer";
  const groupedWithPrevious = isOwnMessage(message) && isOwnMessage(previous);
  return {
    groupedWithPrevious,
    groupedWithNext: isOwnMessage(message) && isOwnMessage(next),
    continuesSteer: groupedWithPrevious && isSteer(message) && isSteer(previous),
  };
}
