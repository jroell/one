import type { EnvironmentId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { ChevronRightIcon, InfoIcon } from "lucide-react";
import { useGT, useMessages } from "gt-react";
import { useId, useRef, useState, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../../ui/popover";
import { useOptionalSettingsScope } from "../SettingsScopeContext";
import { useSettingsPageIntro } from "../SettingsPageHeader";
import {
  useConversationAvailability,
  useStartConversation,
  type StartConversationInput,
} from "./conversation";
import { buildHiddenContext } from "./explainConversation";
import { ExplainProviderFix } from "./ExplainProviderFix";
import { useConversationEnvironmentId, useSetupSnapshot } from "./explainFacts";
import { explainDocsUrl, explainTopic } from "./explainTopics";
import { EMPTY_SETUP, type ExplainTopicId, type SetupSnapshot } from "./explainTypes";

function PartList({
  label,
  items,
}: {
  readonly label: string;
  readonly items: ReadonlyArray<string>;
}) {
  return (
    <section className="grid gap-1">
      <h4 className="text-2xs font-medium text-(--settings-description)">{label}</h4>
      <ul className="grid gap-1 ps-4 text-sm text-pretty [&>li]:list-disc">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function ExplainPopover({
  topicId,
  setup,
  variant,
  className,
  returnLabel,
  environmentId,
}: {
  readonly topicId: ExplainTopicId;
  readonly setup: SetupSnapshot;
  /** The machine the conversation would run on, for the fix offered when no provider is ready. */
  readonly environmentId?: EnvironmentId | undefined;
  readonly variant: "link" | "icon";
  /** The page to return to when it is not a Settings page, such as "Usage". */
  readonly returnLabel?: string | undefined;
  readonly className?: string | undefined;
}) {
  const gt = useGT();
  const m = useMessages();
  const router = useRouter({ warn: false });
  const pageTitle = useSettingsPageIntro()?.title;
  // The key lets an answered topic reopen its thread, which needs no provider.
  const availability = useConversationAvailability(topicId);
  const startConversation = useStartConversation();
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  // The detail starts folded each time, so the action is never below a scroll.
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setDetailOpen(false);
  };
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const reasonId = useId();
  const topic = explainTopic(topicId);
  const docsUrl = explainDocsUrl(topic);
  const label = gt("What is this?");
  // An answered topic reopens its thread, and the button says so.
  const reopens = availability.ok && "reopens" in availability && availability.reopens === true;

  const ask = () => {
    const input: StartConversationInput & {
      readonly actions?: ReadonlyArray<{ readonly label: string; readonly href: string }>;
    } = {
      visibleText: m(topic.question),
      hiddenContext: buildHiddenContext(topicId, setup),
      topicKey: topicId,
      // Chips under the answer that open the places it names.
      ...(topic.actions === undefined || topic.actions.length === 0
        ? {}
        : {
            actions: topic.actions.map((action) => ({ label: m(action.label), href: action.href })),
          }),
      ...(router === undefined
        ? {}
        : {
            returnTo: {
              href: router.state.location.href,
              // Names the page; the way back returns to Settings on that page.
              label: returnLabel ?? pageTitle ?? gt("Settings"),
            },
          }),
    };
    setFailure(null);
    setAsking(true);
    startConversation(input).then(
      () => {
        setAsking(false);
        onOpenChange(false);
      },
      (error: unknown) => {
        // The person stays in Settings, with the reason in front of them.
        setAsking(false);
        setFailure(error instanceof Error ? error.message : gt("Asking One did not work."));
      },
    );
  };

  const { useWhen: whenToUse, skipWhen, youWillNeed } = topic;
  const parts: ReactNode[] = [];
  if (whenToUse) {
    parts.push(
      <PartList key="use" label={gt("Use it when")} items={whenToUse.map((item) => m(item))} />,
    );
  }
  if (skipWhen) {
    parts.push(
      <PartList key="skip" label={gt("Skip it when")} items={skipWhen.map((item) => m(item))} />,
    );
  }
  if (youWillNeed) {
    parts.push(
      <PartList
        key="need"
        label={gt("You will need")}
        items={youWillNeed.map((item) => m(item))}
      />,
    );
  }
  const hasDetail = Boolean(topic.terms) || parts.length > 0;
  const detailId = `${reasonId}-detail`;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        data-explain-trigger={topicId}
        aria-label={variant === "icon" ? label : undefined}
        render={
          <Button
            variant="ghost-muted"
            size={variant === "icon" ? "icon-micro" : "micro"}
            className={className}
          />
        }
      >
        <InfoIcon aria-hidden className="size-3.5" />
        {variant === "link" ? <span>{label}</span> : null}
      </PopoverTrigger>
      <PopoverPopup
        side="bottom"
        align="start"
        padding="compact"
        // Beside or below the trigger (the popover flips when there is no room), never wider than
        // 360 px, and as tall as the window leaves, with its own scroll.
        className="w-[min(22.5rem,calc(100vw-2rem))]"
        ref={popupRef}
        // Focus lands on Ask when it works, otherwise on the panel: never on a link that would read as the action.
        initialFocus={availability.ok ? askRef : popupRef}
      >
        <div data-explain-popup={topicId} className="grid gap-3 py-2">
          <h3 className="text-sm font-semibold text-foreground">{m(topic.title)}</h3>
          <p className="text-sm text-pretty">{m(topic.whatItIs)}</p>
          {topic.verdict === undefined ? null : (
            <p data-explain-verdict="" className="text-sm font-medium text-pretty text-foreground">
              {m(topic.verdict)}
            </p>
          )}
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                ref={askRef}
                size="sm"
                disabled={!availability.ok || asking}
                aria-describedby={availability.ok ? undefined : reasonId}
                onClick={ask}
              >
                {asking
                  ? gt("Opening a conversation…")
                  : reopens
                    ? gt("Continue with One")
                    : gt("Ask One about this")}
              </Button>
              {docsUrl === null ? null : (
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-sm text-xs text-(--settings-description) underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {gt("Read the docs")}
                </a>
              )}
            </div>
            {availability.ok ? null : (
              <p id={reasonId} className="text-xs text-pretty text-(--settings-description)">
                {availability.reason}
              </p>
            )}
            {availability.ok || environmentId === undefined ? null : (
              <ExplainProviderFix
                environmentId={environmentId}
                onOpenProviders={() => onOpenChange(false)}
              />
            )}
            {failure === null ? null : (
              <p role="alert" className="text-xs text-pretty text-destructive-foreground">
                {failure}
              </p>
            )}
          </div>
          {hasDetail ? (
            <div className="grid gap-3 border-t border-(--settings-hairline) pt-2">
              <button
                type="button"
                aria-expanded={detailOpen}
                aria-controls={detailId}
                className="flex w-fit cursor-pointer items-center gap-1 rounded-sm text-xs text-(--settings-description) outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => setDetailOpen((value) => !value)}
              >
                <ChevronRightIcon
                  aria-hidden
                  className={cn("size-3.5 transition-transform", detailOpen && "rotate-90")}
                />
                {gt("More detail")}
              </button>
              {detailOpen ? (
                <div id={detailId} data-explain-detail="" className="grid gap-3">
                  {topic.terms ? (
                    <dl className="grid gap-1.5 text-sm">
                      {topic.terms.map((entry) => (
                        <div key={entry.term} className="grid gap-0.5">
                          <dt className="font-medium">{m(entry.term)}</dt>
                          <dd className="text-pretty text-(--settings-description)">
                            {m(entry.meaning)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {parts}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function ExplainWithSetup(
  props: Parameters<typeof ExplainPopover>[0] & {
    environmentId: Parameters<typeof useSetupSnapshot>[0];
    otherMachineViewed: boolean;
  },
) {
  const m = useMessages();
  const setup = useSetupSnapshot(props.environmentId, m, props.otherMachineViewed);
  return <ExplainPopover {...props} setup={setup} />;
}

/**
 * A quiet "What is this?" beside a section title or inside an empty state. It opens a short
 * explanation in plain words, and "Ask One about this" starts a conversation about it.
 */
export function ExplainControl({
  topic,
  variant = "link",
  className,
  returnLabel,
}: {
  readonly topic: ExplainTopicId;
  readonly variant?: "link" | "icon";
  readonly className?: string;
  readonly returnLabel?: string;
}) {
  const scope = useOptionalSettingsScope();
  const viewedId = scope?.environment?.environmentId ?? null;
  // The conversation opens on the primary machine, so the facts come from there, not from the
  // machine Settings happens to show.
  const conversationId = useConversationEnvironmentId();
  const environmentId = conversationId ?? viewedId;
  const otherMachineViewed =
    viewedId !== null && environmentId !== null && viewedId !== environmentId;
  return environmentId === null ? (
    <ExplainPopover
      topicId={topic}
      setup={EMPTY_SETUP}
      variant={variant}
      className={className}
      returnLabel={returnLabel}
    />
  ) : (
    <ExplainWithSetup
      topicId={topic}
      setup={EMPTY_SETUP}
      variant={variant}
      className={className}
      returnLabel={returnLabel}
      environmentId={environmentId}
      otherMachineViewed={otherMachineViewed}
    />
  );
}
