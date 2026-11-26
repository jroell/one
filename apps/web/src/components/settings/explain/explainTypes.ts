/** What the person's setup looks like, as names and states only. Nothing secret ever enters it. */
export interface SetupSnapshot {
  /** The person was looking at another machine in Settings; these facts describe the machine the conversation runs on. */
  readonly otherMachineViewed?: boolean;
  readonly providers: ReadonlyArray<{
    /** The name shown in the list (cleaned of anything shaped like a key or address). */
    readonly name: string;
    readonly driver: string;
    readonly enabled: boolean;
    /** Ready, Needs attention, Failed, Off or Checking: the words the list shows. */
    readonly state: string;
    /** The plan label the list shows, such as "ChatGPT Pro", when signed in. */
    readonly plan: string | null;
  }>;
  readonly usageSources: ReadonlyArray<{
    readonly kind: "hub" | "http";
    readonly enabled: boolean;
  }>;
  readonly textGenerators: ReadonlyArray<{ readonly service: string; readonly enabled: boolean }>;
}

export const EMPTY_SETUP: SetupSnapshot = {
  providers: [],
  usageSources: [],
  textGenerators: [],
};

/** Topics for the rest of Settings and for the Usage sheet, defined in `explainTopicsMore.ts`. */
export type MoreExplainTopicId =
  | "environments"
  | "t3-connect"
  | "authorized-clients"
  | "secrets"
  | "voice-transcription"
  | "source-control-providers"
  | "background-activity"
  | "browser-profiles"
  | "usage-sign-in"
  | "usage-no-accounts";

export type ExplainTopicId =
  | MoreExplainTopicId
  | "usage-providers"
  | "usage-hub"
  | "usage-http-source"
  | "text-generators"
  | "providers"
  | "provider-status"
  | "snapshots"
  | "scheduled-tasks"
  | "archive"
  | "devices"
  | "guest-links"
  | "linked-environments"
  | "workflows"
  | "preview-tunnel";

export interface ExplainTopic {
  readonly id: ExplainTopicId;
  readonly title: string;
  /** One or two sentences: what this is. */
  readonly whatItIs: string;
  /**
   * One plain line for the common case, shown right under the first sentence: whether most people
   * need this. It uses no term the first sentence has not explained.
   */
  readonly verdict?: string;
  /** Optional terms the sentence leans on, each with its meaning. */
  readonly terms?: ReadonlyArray<{
    readonly term: string;
    readonly meaning: string;
  }>;
  readonly useWhen?: ReadonlyArray<string>;
  readonly skipWhen?: ReadonlyArray<string>;
  readonly youWillNeed?: ReadonlyArray<string>;
  /** The first message of the conversation, in the person's own voice. */
  readonly question: string;
  /**
   * What the model may rely on, in English: written from what the code and docs/user say this
   * does, never from memory of a similar product. The model sees it; the person does not.
   */
  readonly notes: string;
  /** A page under docs/user, only where one covers the topic. */
  readonly docs?: { readonly page: string; readonly anchor?: string };
  /** Names and states from this person's setup that bear on the question. */
  readonly facts: (setup: SetupSnapshot) => ReadonlyArray<string>;
}
