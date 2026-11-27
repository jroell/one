import { Spinner } from "~/components/ui/spinner";

import { Toast } from "@base-ui/react/toast";
import { msg, useGT } from "gt-react";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { type ScopedThreadRef, type ThreadId } from "@t3tools/contracts";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { Button, buttonVariants } from "~/components/ui/button";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import {
  buildVisibleToastLayout,
  hasVisibleToastAction,
  shouldRenderThreadScopedToast,
} from "./toast.logic";
import { useThreadRouteTarget } from "~/hooks/useThreadRouteTarget";
import { useComposerAnchor, useToastLane } from "./useComposerAnchor";
import { ToastQueue, type ToastQueueEvent, type WaitingToast } from "./toast.queue";
import { Popover, PopoverPopup, PopoverTrigger } from "./popover";
import { SharedTooltipTrigger } from "./shared-tooltip";

export type ThreadToastData = {
  threadRef?: ScopedThreadRef | null;
  threadId?: ThreadId | null;
  leadingIcon?: ReactNode;
  tooltipStyle?: boolean;
  onClose?: (() => void) | undefined;
  dismissAfterVisibleMs?: number;
  hideCopyButton?: boolean;
  additionalActions?: ReadonlyArray<{
    id: string;
    props: ComponentPropsWithoutRef<"button">;
  }>;
  secondaryActionProps?: ComponentPropsWithoutRef<"button">;
  secondaryActionVariant?:
    | "default"
    | "destructive"
    | "destructive-outline"
    | "ghost"
    | "link"
    | "outline"
    | "secondary";
  /** A recoverable error offers a real action: it renders a Retry button that calls this. */
  onRetry?: (() => void) | undefined;
  expandableContent?: ReactNode;
  expandableLabels?: { expand?: string; collapse?: string };
  expandableDescriptionTrigger?: boolean;
  actionLayout?: "inline" | "stacked-end";
  actionVariant?:
    | "default"
    | "destructive"
    | "destructive-outline"
    | "ghost"
    | "link"
    | "outline"
    | "secondary";
};

type BaseToastManager = ReturnType<typeof Toast.createToastManager<ThreadToastData>>;
type BufferedToastManager = BaseToastManager & { readonly queue: ToastQueue | null };
/** The thread whose scoped toasts may be shown; set by the viewport. */
let queueActiveThreadRef: ScopedThreadRef | null = null;
/** While true no toast is shown: new ones wait in the queue, and the one on screen goes back to it. */
let toastsSuppressed = false;

/** The voice stage turns toasts off while it is open and on again when it closes. */
export function setToastsSuppressed(suppressed: boolean): void {
  if (toastsSuppressed === suppressed) return;
  toastsSuppressed = suppressed;
  toastManager.queue?.refresh();
}
type ToastManagerListener = Parameters<BaseToastManager[" subscribe"]>[0];
type ToastManagerEvent = Parameters<ToastManagerListener>[0];

/**
 * base-ui's manager drops events while no provider is subscribed. App services raise toasts
 * from before the first render (and while the root error view replaces the providers), so hold
 * those until a provider listens.
 */
function createBufferedToastManager(options: { queued: boolean }): BufferedToastManager {
  const manager = Toast.createToastManager<ThreadToastData>();
  const listeners = new Set<ToastManagerListener>();
  const pending: ToastManagerEvent[] = [];
  const deliver = (event: ToastManagerEvent) => {
    // An anchored confirmation is momentary, so one raised under suppression is not kept.
    if (toastsSuppressed && !options.queued && event.action === "add") return;
    if (listeners.size === 0) {
      // A queue keeps its own state and re-shows it when a provider mounts.
      if (!options.queued) pending.push(event);
      return;
    }
    for (const listener of listeners) listener(event);
  };
  const queue = options.queued
    ? new ToastQueue({
        deliver: (event) => deliver(event as unknown as ToastManagerEvent),
        isAttached: () => listeners.size > 0,
        hasFocusWithin: () => {
          const viewport = document.querySelector('[data-slot="toast-viewport"]');
          return viewport !== null && viewport.contains(document.activeElement);
        },
        isRenderable: (toast) =>
          !toastsSuppressed &&
          shouldRenderThreadScopedToast(
            toast.data as Parameters<typeof shouldRenderThreadScopedToast>[0],
            queueActiveThreadRef,
          ),
      })
    : null;
  manager[" subscribe"]((event) => {
    if (queue) queue.handle(event as unknown as ToastQueueEvent);
    else deliver(event);
  });
  return {
    ...manager,
    queue,
    " subscribe"(listener) {
      listeners.add(listener);
      for (const event of pending.splice(0)) listener(event);
      queue?.attach();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) queue?.detach();
      };
    },
  };
}

const toastManager = createBufferedToastManager({ queued: true });
const anchoredToastManager = createBufferedToastManager({ queued: false });
type ToastId = ReturnType<typeof toastManager.add>;
const threadToastVisibleTimeoutRemainingMs = new Map<ToastId, number>();

const TOAST_ICONS = {
  error: CircleAlertIcon,
  info: InfoIcon,
  loading: Spinner,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
} as const;

const ERROR_DESCRIPTION_CLAMP_MIN_CHARS = 180;
function errorDescriptionClampClass(type: unknown, description: unknown): string | undefined {
  if (type !== "error" || typeof description !== "string") {
    return undefined;
  }
  if (description.length < ERROR_DESCRIPTION_CLAMP_MIN_CHARS) {
    return undefined;
  }
  return "line-clamp-4";
}

// The close button shows while the toast is hovered or holds focus, and always on touch.
const toastCornerDismissClass =
  "absolute z-20 top-1.5 right-1.5 opacity-0 transition-opacity duration-(--mo-hover) group-hover/toast:opacity-100 group-focus-within/toast:opacity-100 [@media(hover:none)]:opacity-100";
const toastCornerOrbClass = cn(
  "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none",
  "transition-[color,background-color] hover:bg-(--ui-hover) hover:text-foreground",
  "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
);

function handleToastDismissClick(
  manager: typeof toastManager | typeof anchoredToastManager,
  toastId: ToastId,
  onClose: (() => void) | undefined,
) {
  onClose?.();
  manager.close(toastId);
}

function CopyErrorButton({ text }: { text: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "error-message",
      unavailableMessage: msg("Clipboard API is unavailable while copying error-message."),
      failureMessage: msg("Failed to copy error-message to the clipboard."),
    },
  });
  const gt = useGT();
  const label = isCopied ? gt("Copied error") : gt("Copy error");

  return (
    <SharedTooltipTrigger
      render={
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label={label}
          className="[--control-icon-color:currentColor] rounded-md text-muted-foreground/80 hover:bg-transparent hover:text-muted-foreground"
          onClick={() => copyToClipboard(text)}
        />
      }
      label={label}
    >
      {isCopied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
    </SharedTooltipTrigger>
  );
}

const toastExpandablePanelClassName =
  "mt-2 max-h-40 min-h-0 overflow-y-auto overscroll-contain pr-0.5 select-text";

function ToastExpandableSection({
  children,
  labels,
}: {
  children: ReactNode;
  labels: { expand?: string; collapse?: string };
}) {
  const [open, setOpen] = useState(false);
  const gt = useGT();
  const expandLabel = labels.expand ?? gt("Show details");
  const collapseLabel = labels.collapse ?? gt("Hide details");

  return (
    <div className="min-w-0">
      <button
        aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-1 rounded-md py-0.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        {open ? (
          <ChevronUpIcon className="size-3.5 shrink-0 opacity-80" strokeWidth={2.25} />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-80" strokeWidth={2.25} />
        )}
        {open ? collapseLabel : expandLabel}
      </button>
      {open ? <div className={toastExpandablePanelClassName}>{children}</div> : null}
    </div>
  );
}

function ToastDescriptionAndExpandable({
  toastData,
  toastDescription,
  toastType,
}: {
  toastData: ThreadToastData | undefined;
  toastDescription: unknown;
  toastType: unknown;
}) {
  const expandableContent = toastData?.expandableContent;
  const labels = toastData?.expandableLabels ?? {};
  const descriptionTrigger = toastData?.expandableDescriptionTrigger ?? false;
  const gt = useGT();
  const descriptionClassName = cn(
    "min-w-0 select-text wrap-break-word text-muted-foreground",
    errorDescriptionClampClass(toastType, toastDescription),
  );
  const [open, setOpen] = useState(false);

  if (!expandableContent) {
    return <Toast.Description className={descriptionClassName} data-slot="toast-description" />;
  }

  if (!descriptionTrigger) {
    return (
      <>
        <Toast.Description className={descriptionClassName} data-slot="toast-description" />
        <ToastExpandableSection labels={labels}>{expandableContent}</ToastExpandableSection>
      </>
    );
  }

  const expandLabel = labels.expand ?? gt("Show details");
  const collapseLabel = labels.collapse ?? gt("Hide details");

  const toggle = () => setOpen((v) => !v);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };

  return (
    <>
      <SharedTooltipTrigger
        render={
          <div
            aria-label={open ? collapseLabel : expandLabel}
            aria-expanded={open}
            className={cn(
              "group flex min-w-0 w-full cursor-pointer select-none items-start gap-1.5 rounded-sm text-left outline-none ring-offset-background",
              "transition-colors hover:bg-muted/40",
              "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            )}
            onClick={toggle}
            onKeyDown={onKeyDown}
            role="button"
            tabIndex={0}
          />
        }
        label={open ? collapseLabel : expandLabel}
      >
        <div className="min-w-0 flex-1">
          <Toast.Description
            className={cn(
              "min-w-0 select-none wrap-break-word text-muted-foreground",
              errorDescriptionClampClass(toastType, toastDescription),
              "underline-offset-2 decoration-muted-foreground/60 group-hover:underline",
            )}
            data-slot="toast-description"
          />
        </div>
        {open ? (
          <ChevronUpIcon
            aria-hidden
            className="size-3.5 h-lh shrink-0 text-muted-foreground opacity-80"
            strokeWidth={2.25}
          />
        ) : (
          <ChevronDownIcon
            aria-hidden
            className="size-3.5 h-lh shrink-0 text-muted-foreground opacity-80"
            strokeWidth={2.25}
          />
        )}
      </SharedTooltipTrigger>
      {open ? <div className={toastExpandablePanelClassName}>{expandableContent}</div> : null}
    </>
  );
}

const NO_WAITING_TOASTS: readonly WaitingToast[] = [];

/** "+N": the toasts waiting behind this one, with a way to show one now or dismiss it. */
function WaitingToastsButton({ waiting }: { waiting: readonly WaitingToast[] }) {
  const gt = useGT();
  const queue = toastManager.queue!;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            aria-label={gt("{count} more notifications", { count: waiting.length })}
            className="ml-auto shrink-0 cursor-pointer rounded-full px-1.5 text-xs text-muted-foreground tabular-nums outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            data-slot="toast-count"
            type="button"
          />
        }
      >
        +{waiting.length}
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-72" data-slot="toast-waiting" side="top">
        <ul className="flex flex-col gap-0.5 py-1" aria-label={gt("Waiting notifications")}>
          {waiting.map((item) => {
            const Icon = item.type ? TOAST_ICONS[item.type as keyof typeof TOAST_ICONS] : null;
            return (
              <li className="flex items-center gap-2" data-type={item.type} key={item.id}>
                <button
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-(--ui-hover) focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  data-slot="toast-waiting-show"
                  onClick={() => queue.promote(item.id)}
                  type="button"
                >
                  {Icon ? (
                    <span data-slot="toast-icon">
                      <Icon className="size-4 shrink-0" />
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{item.title as ReactNode}</span>
                </button>
                <button
                  aria-label={gt("Dismiss notification")}
                  className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-(--ui-hover) hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  data-slot="toast-waiting-dismiss"
                  onClick={() => toastManager.close(item.id)}
                  type="button"
                >
                  <XIcon className="size-3" strokeWidth={2.25} />
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverPopup>
    </Popover>
  );
}

type ToastIconComponent = (typeof TOAST_ICONS)[keyof typeof TOAST_ICONS];

interface ToastBodyDescriptor {
  readonly Icon: ToastIconComponent | null | undefined;
  readonly stackedActionLayout: boolean;
  readonly actionVariant: NonNullable<ThreadToastData["actionVariant"]>;
  readonly secondaryActionVariant: NonNullable<ThreadToastData["secondaryActionVariant"]>;
  readonly copyErrorText: string | null;
  readonly hasTrailingControls: boolean;
  readonly inlineContentEndPad: string;
}

function deriveToastBodyDescriptor(toast: {
  readonly type?: string | undefined;
  readonly description?: unknown;
  readonly actionProps?: unknown;
  readonly data?: ThreadToastData | undefined;
}): ToastBodyDescriptor {
  const Icon = toast.type ? TOAST_ICONS[toast.type as keyof typeof TOAST_ICONS] : null;
  const stackedActionLayout =
    hasVisibleToastAction(toast.actionProps) && toast.data?.actionLayout === "stacked-end";
  const actionVariant: NonNullable<ThreadToastData["actionVariant"]> =
    toast.data?.actionVariant ?? "default";
  const secondaryActionVariant: NonNullable<ThreadToastData["secondaryActionVariant"]> =
    toast.data?.secondaryActionVariant ?? "outline";
  const copyErrorText =
    toast.type === "error" && typeof toast.description === "string" && !toast.data?.hideCopyButton
      ? toast.description
      : null;
  const hasAdditionalActions = (toast.data?.additionalActions?.length ?? 0) > 0;
  const hasSecondaryAction = toast.data?.secondaryActionProps !== undefined;
  const hasTrailingControls =
    toast.data?.onRetry !== undefined ||
    copyErrorText !== null ||
    hasVisibleToastAction(toast.actionProps) ||
    hasAdditionalActions ||
    hasSecondaryAction;
  const inlineContentEndPad = hasTrailingControls ? "pr-6" : "pr-3.5";
  return {
    Icon,
    stackedActionLayout,
    actionVariant,
    secondaryActionVariant,
    copyErrorText,
    hasTrailingControls,
    inlineContentEndPad,
  };
}

interface ToastBodyContentProps extends ToastBodyDescriptor {
  readonly toastId: ToastId;
  readonly waiting?: readonly WaitingToast[];
  readonly actionProps: { readonly children?: ReactNode } | undefined;
  readonly toastData: ThreadToastData | undefined;
  readonly toastDescription: unknown;
  readonly toastType: unknown;
}

function ToastBodyContent({
  toastId,
  waiting = NO_WAITING_TOASTS,
  stackedActionLayout,
  Icon,
  copyErrorText,
  actionProps,
  actionVariant,
  secondaryActionVariant,
  hasTrailingControls,
  toastData,
  toastDescription,
  toastType,
}: ToastBodyContentProps) {
  const gt = useGT();
  const { close } = Toast.useToastManager<ThreadToastData>();
  const additionalActions = toastData?.additionalActions ?? [];
  const onRetry = toastData?.onRetry;
  const secondaryActionProps = toastData?.secondaryActionProps;
  const leadingIcon = toastData?.leadingIcon;
  const { className: secondaryActionClassName, ...secondaryActionRest } =
    secondaryActionProps ?? {};

  return (
    <>
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col gap-0.5",
          stackedActionLayout ? "pr-5" : "flex-1",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 gap-2",
            !stackedActionLayout && !hasTrailingControls && "pr-6",
          )}
        >
          {leadingIcon ? (
            <div
              className="flex h-lh w-4 shrink-0 items-center justify-center"
              data-slot="toast-icon"
            >
              {leadingIcon}
            </div>
          ) : Icon ? (
            <div
              className="[&>svg]:h-lh [&>svg]:w-4 [&_svg]:pointer-events-none [&_svg]:shrink-0"
              data-slot="toast-icon"
            >
              <Icon className="in-data-[type=error]:text-destructive in-data-[type=info]:text-info in-data-[type=success]:text-success in-data-[type=warning]:text-warning in-data-[type=loading]:opacity-80" />
            </div>
          ) : null}
          <Toast.Title className="min-w-0 wrap-break-word font-medium" data-slot="toast-title" />
          {waiting.length > 0 ? <WaitingToastsButton waiting={waiting} /> : null}
        </div>
        <ToastDescriptionAndExpandable
          toastData={toastData}
          toastDescription={toastDescription}
          toastType={toastType}
        />
      </div>
      {hasTrailingControls ? (
        <div
          className={cn(
            "flex items-center gap-1.5",
            stackedActionLayout ? "w-full justify-end" : "shrink-0",
          )}
        >
          {copyErrorText !== null ? <CopyErrorButton text={copyErrorText} /> : null}
          {onRetry ? (
            <Button
              data-slot="toast-retry"
              onClick={() => {
                onRetry();
                close(toastId);
              }}
              size="xs"
              type="button"
              variant="outline"
            >
              {gt("Retry")}
            </Button>
          ) : null}
          {additionalActions.map(({ id, props: { className, ...props } }) => (
            <Button
              {...props}
              className={className}
              key={id}
              size="xs"
              type="button"
              variant={secondaryActionVariant}
            />
          ))}
          {secondaryActionProps ? (
            <Button
              {...secondaryActionRest}
              className={secondaryActionClassName}
              size="xs"
              type="button"
              variant={secondaryActionVariant}
            />
          ) : null}
          {hasVisibleToastAction(actionProps) ? (
            <Toast.Action
              className={cn(buttonVariants({ size: "xs", variant: actionVariant }), "shrink-0")}
              data-slot="toast-action"
            >
              {actionProps?.children}
            </Toast.Action>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** Toasts have one place on every page: above the composer, else the bottom of the main column. */
const TOAST_POSITION = "bottom-center";

function useActiveThreadRefFromRoute(): ScopedThreadRef | null {
  const routeTarget = useThreadRouteTarget();
  const activeDraftSession = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );

  if (routeTarget?.kind === "server") {
    return routeTarget.threadRef;
  }
  if (routeTarget?.kind === "draft" && activeDraftSession) {
    return {
      environmentId: activeDraftSession.environmentId,
      threadId: activeDraftSession.threadId,
    };
  }
  return null;
}

function ThreadToastVisibleAutoDismiss({
  toastId,
  dismissAfterVisibleMs,
}: {
  toastId: ToastId;
  dismissAfterVisibleMs: number | undefined;
}) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- dismiss timer that pauses on visibilitychange, focus and blur so it only counts visible time
  useEffect(() => {
    if (!dismissAfterVisibleMs || dismissAfterVisibleMs <= 0) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let remainingMs = threadToastVisibleTimeoutRemainingMs.get(toastId) ?? dismissAfterVisibleMs;
    let startedAtMs: number | null = null;
    let timeoutId: number | null = null;
    let closed = false;

    const clearTimer = () => {
      if (timeoutId === null) return;
      window.clearTimeout(timeoutId);
      timeoutId = null;
    };

    const closeToast = () => {
      if (closed) return;
      closed = true;
      threadToastVisibleTimeoutRemainingMs.delete(toastId);
      toastManager.close(toastId);
    };

    const pause = () => {
      if (startedAtMs === null) return;
      remainingMs = Math.max(0, remainingMs - (Date.now() - startedAtMs));
      startedAtMs = null;
      clearTimer();
      threadToastVisibleTimeoutRemainingMs.set(toastId, remainingMs);
    };

    const start = () => {
      if (closed || startedAtMs !== null) return;
      if (remainingMs <= 0) {
        closeToast();
        return;
      }
      startedAtMs = Date.now();
      clearTimer();
      timeoutId = window.setTimeout(() => {
        remainingMs = 0;
        startedAtMs = null;
        closeToast();
      }, remainingMs);
    };

    const syncTimer = () => {
      const shouldRun = document.visibilityState === "visible" && document.hasFocus();
      if (shouldRun) {
        start();
        return;
      }
      pause();
    };

    syncTimer();
    document.addEventListener("visibilitychange", syncTimer);
    window.addEventListener("focus", syncTimer);
    window.addEventListener("blur", syncTimer);

    return () => {
      document.removeEventListener("visibilitychange", syncTimer);
      window.removeEventListener("focus", syncTimer);
      window.removeEventListener("blur", syncTimer);
      pause();
      clearTimer();
    };
  }, [dismissAfterVisibleMs, toastId]);

  return null;
}

function ToastProvider({ children, ...props }: Toast.Provider.Props) {
  return (
    <Toast.Provider toastManager={toastManager} {...props}>
      {children}
      <Toasts />
    </Toast.Provider>
  );
}

function Toasts() {
  const { toasts } = Toast.useToastManager<ThreadToastData>();
  const activeThreadRef = useActiveThreadRefFromRoute();
  const gt = useGT();
  const visibleToasts = toasts.filter((toast) =>
    shouldRenderThreadScopedToast(toast.data, activeThreadRef),
  );
  // One toast is live at a time; an ended one stays mounted until its exit finishes, so Base UI
  // can remove it and run its callbacks. The rest wait in the queue and show as a +N list.
  const waiting = useSyncExternalStore(
    toastManager.queue!.subscribe,
    toastManager.queue!.getWaiting,
    toastManager.queue!.getWaiting,
  );
  const visibleToastLayout = buildVisibleToastLayout(visibleToasts);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the queue which thread's scoped toasts may be shown
  useEffect(() => {
    queueActiveThreadRef = activeThreadRef;
    toastManager.queue?.refresh();
  }, [activeThreadRef]);
  const anchor = useComposerAnchor(visibleToasts.length > 0, visibleToastLayout.frontmostHeight);
  useToastLane(visibleToasts.length > 0, visibleToastLayout.frontmostHeight);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- prunes the module-level remaining-time map of toasts the manager has dropped
  useEffect(() => {
    const activeToastIds = new Set(toasts.map((toast) => toast.id));
    for (const toastId of threadToastVisibleTimeoutRemainingMs.keys()) {
      if (!activeToastIds.has(toastId)) {
        threadToastVisibleTimeoutRemainingMs.delete(toastId);
      }
    }
  }, [toasts]);

  return (
    <Toast.Portal data-slot="toast-portal">
      <Toast.Viewport
        aria-label={gt("Notifications", { $context: "screen reader name of the toast area" })}
        className={cn(
          "fixed z-100 mx-auto flex w-[calc(100%-var(--toast-inset)*2)] max-w-90 [--toast-header-offset:var(--workspace-topbar-height)] [--toast-inset:--spacing(4)] sm:[--toast-inset:--spacing(8)]",
          "data-[position*=top]:top-[calc(var(--toast-inset)+var(--toast-header-offset))]",
          "data-[position*=bottom]:bottom-(--toast-inset)",
          "data-[position*=left]:left-(--toast-inset)",
          "data-[position*=right]:right-(--toast-inset)",
          "data-[position*=center]:-translate-x-1/2 data-[position*=center]:left-1/2",
        )}
        data-position={TOAST_POSITION}
        data-slot="toast-viewport"
        style={
          {
            "--toast-frontmost-height": `${visibleToastLayout.frontmostHeight}px`,
            ...(anchor
              ? { bottom: anchor.bottom, left: anchor.left, width: Math.min(anchor.width, 360) }
              : {}),
          } as CSSProperties
        }
      >
        {visibleToastLayout.items.map(({ toast, visibleIndex, offsetY }) => {
          const bodyDescriptor = deriveToastBodyDescriptor(toast);
          const { stackedActionLayout, inlineContentEndPad } = bodyDescriptor;

          return (
            <Toast.Root
              className={cn(
                // One live toast: it sits at the viewport's bottom edge. Its enter and exit are
                // the opacity and translate rules in one-ui.css, on the one y axis.
                "dropdown-glass group/toast absolute inset-x-0 bottom-0 z-[calc(9999-var(--toast-index))] w-full overflow-visible select-none rounded-(--m-radius-floating) text-popover-foreground",
              )}
              data-position={TOAST_POSITION}
              key={toast.id}
              style={
                {
                  "--toast-index": visibleIndex,
                  "--toast-offset-y": `${offsetY}px`,
                } as CSSProperties
              }
              swipeDirection={["down"]}
              toast={toast}
            >
              <ThreadToastVisibleAutoDismiss
                dismissAfterVisibleMs={toast.data?.dismissAfterVisibleMs}
                toastId={toast.id}
              />
              <div className={toastCornerDismissClass}>
                <button
                  aria-label={gt("Dismiss notification")}
                  className={toastCornerOrbClass}
                  data-slot="toast-close"
                  onClick={() =>
                    handleToastDismissClick(toastManager, toast.id, toast.data?.onClose)
                  }
                  type="button"
                >
                  <XIcon className="size-3" strokeWidth={2.25} />
                </button>
              </div>
              <Toast.Content
                className={cn(
                  // overflow-x:clip preserves visible vertical overflow; hidden would force overflow-y:auto
                  // and clip detail panels.
                  "pointer-events-auto min-h-0 overflow-y-visible pl-3.5 text-sm transition-opacity duration-(--mo-surface) [overflow-x:clip] data-expanded:opacity-100",
                  stackedActionLayout
                    ? "flex flex-col gap-2 py-2.5 pr-3.5"
                    : cn("py-3", "flex items-center justify-between gap-1.5", inlineContentEndPad),
                )}
              >
                <ToastBodyContent
                  {...bodyDescriptor}
                  actionProps={toast.actionProps}
                  waiting={visibleIndex === 0 ? waiting : NO_WAITING_TOASTS}
                  toastData={toast.data}
                  toastDescription={toast.description}
                  toastId={toast.id}
                  toastType={toast.type}
                />
              </Toast.Content>
            </Toast.Root>
          );
        })}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

function AnchoredToastProvider({ children, ...props }: Toast.Provider.Props) {
  return (
    <Toast.Provider toastManager={anchoredToastManager} {...props}>
      {children}
      <AnchoredToasts />
    </Toast.Provider>
  );
}

function AnchoredToasts() {
  const { toasts } = Toast.useToastManager<ThreadToastData>();
  const activeThreadRef = useActiveThreadRefFromRoute();
  const gt = useGT();

  return (
    <Toast.Portal data-slot="toast-portal-anchored">
      <Toast.Viewport
        aria-label={undefined}
        className="outline-none"
        data-slot="toast-viewport-anchored"
        role={undefined}
      >
        {toasts
          .filter((toast) => shouldRenderThreadScopedToast(toast.data, activeThreadRef))
          .map((toast) => {
            const tooltipStyle = toast.data?.tooltipStyle ?? false;
            const positionerProps = toast.positionerProps;
            const bodyDescriptor = deriveToastBodyDescriptor(toast);
            const { stackedActionLayout, inlineContentEndPad } = bodyDescriptor;

            if (!positionerProps?.anchor) {
              return null;
            }

            return (
              <Toast.Positioner
                className="z-100 max-w-[min(--spacing(64),var(--available-width))]"
                data-slot="toast-positioner"
                key={toast.id}
                sideOffset={positionerProps.sideOffset ?? 4}
                toast={toast}
              >
                <Toast.Root
                  className={cn(
                    "dropdown-glass group/toast relative overflow-visible text-balance text-popover-foreground text-xs",
                    tooltipStyle ? "rounded-md" : "rounded-(--m-radius-floating)",
                  )}
                  data-slot="toast-popup"
                  toast={toast}
                >
                  {tooltipStyle ? (
                    <Toast.Content className="pointer-events-auto px-2 py-1">
                      <Toast.Title data-slot="toast-title" />
                    </Toast.Content>
                  ) : (
                    <>
                      <div className={toastCornerDismissClass}>
                        <button
                          aria-label={gt("Dismiss notification")}
                          className={toastCornerOrbClass}
                          data-slot="toast-close"
                          onClick={() =>
                            handleToastDismissClick(
                              anchoredToastManager,
                              toast.id,
                              toast.data?.onClose,
                            )
                          }
                          type="button"
                        >
                          <XIcon className="size-3" strokeWidth={2.25} />
                        </button>
                      </div>
                      <Toast.Content
                        className={cn(
                          "pointer-events-auto min-h-0 overflow-y-visible pl-3.5 text-sm [overflow-x:clip]",
                          stackedActionLayout
                            ? "flex flex-col gap-2 py-2.5 pr-3.5"
                            : cn(
                                "py-3",
                                "flex items-center justify-between gap-1.5",
                                inlineContentEndPad,
                              ),
                        )}
                      >
                        <ToastBodyContent
                          {...bodyDescriptor}
                          actionProps={toast.actionProps}
                          toastData={toast.data}
                          toastDescription={toast.description}
                          toastId={toast.id}
                          toastType={toast.type}
                        />
                      </Toast.Content>
                    </>
                  )}
                </Toast.Root>
              </Toast.Positioner>
            );
          })}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export { stackedThreadToast } from "./toastHelpers";
export type { StackedThreadToastOptions } from "./toastHelpers";

export { ToastProvider, toastManager, AnchoredToastProvider, anchoredToastManager };
