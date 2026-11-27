import {
  Children,
  createContext,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";
import { closeRowsBelow, openRowsBelow, type RowsClosing } from "./rowsBelowFollow";

const GroupedRows = createContext(false);

/** Groups may span virtualized timeline items. Each part owns its trailing space. */
export function WorkLogBlock({
  layout = "standalone",
  continues = false,
  children,
}: {
  layout?: "standalone" | "group-header" | "group-content";
  continues?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div
      className={
        continues || layout === "group-header"
          ? "pb-0"
          : layout === "group-content"
            ? "pb-1"
            : "pb-2"
      }
    >
      {children}
    </div>
  );
}

export function WorkLogList({ children }: { children: ReactNode }) {
  return (
    <GroupedRows value>
      <div className="flex min-w-0 flex-col">{children}</div>
    </GroupedRows>
  );
}

type RowContent = {
  icon?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  wrapLabel?: boolean;
};

const focusRingClassName =
  "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70";

type LineProps = Omit<ComponentProps<"div">, "className" | "style" | "children">;

function WorkLogLine({ icon, label, trailing, wrapLabel, ...lineProps }: RowContent & LineProps) {
  return (
    <div
      {...lineProps}
      data-one-work-line=""
      className={cn(
        "flex min-h-6 min-w-0 gap-1.5 text-sm leading-relaxed select-none [&_*]:select-none",
        wrapLabel ? "items-start" : "items-center",
        lineProps.role === "button" && focusRingClassName,
      )}
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        {icon ? (
          <span className="relative w-6 shrink-0 leading-0" data-one-work-icon="">
            <span className="inline-block size-6 overflow-hidden align-[calc(0.5cap_-_0.75rem)]">
              <span className="flex size-full items-center justify-center">{icon}</span>
            </span>
          </span>
        ) : null}
        <div
          className={cn(
            "min-w-0 flex-1 text-secondary-label",
            !wrapLabel && "truncate [&_*]:whitespace-nowrap",
          )}
        >
          {label}
        </div>
      </div>
      {trailing}
    </div>
  );
}

function useRowClassName(interactive: boolean, focusable = interactive) {
  const grouped = use(GroupedRows);
  return cn(
    "group/timeline-row relative w-full min-w-0 rounded-md px-0.5 text-left transition-colors",
    grouped ? "py-0" : "py-0.5",
    interactive && "cursor-pointer",
    focusable && focusRingClassName,
  );
}

export function WorkLogButton({
  icon,
  label,
  trailing,
  wrapLabel = false,
  ...buttonProps
}: RowContent & Omit<ComponentProps<"button">, "className" | "style" | "children">) {
  const className = useRowClassName(true);
  return (
    <button
      {...buttonProps}
      type="button"
      data-one-work-row=""
      data-one-interactive=""
      className={className}
    >
      <WorkLogLine icon={icon} label={label} trailing={trailing} wrapLabel={wrapLabel} />
    </button>
  );
}

type RowProps = Omit<ComponentProps<"div">, "className" | "style"> & {
  toggle?: LineProps | undefined;
};

/**
 * Div disclosure permits selectable detail and nested actions. `toggle` goes on
 * the header line only: assistive tech hides a button's children.
 */
export function WorkLogRow({
  icon,
  label,
  trailing,
  wrapLabel = false,
  toggle,
  children,
  ...rowProps
}: RowContent & RowProps) {
  const className = useRowClassName(rowProps.onClick !== undefined, false);
  const detailsId = useId();
  return (
    <div
      {...rowProps}
      data-one-work-row=""
      data-one-interactive={rowProps.onClick !== undefined ? "" : undefined}
      className={className}
    >
      <WorkLogLine
        aria-controls={toggle ? detailsId : undefined}
        {...toggle}
        icon={icon}
        label={label}
        trailing={trailing}
        wrapLabel={wrapLabel}
      />
      {toggle ? <div id={detailsId}>{children}</div> : children}
    </div>
  );
}

const LIVE_EDGE_PX = 4;

const ClosingContext = createContext(false);
const ToggledContext = createContext(false);

/**
 * Keeps what a row opened showing while it closes. The row passes its details only while it is
 * open; when it stops, the last details stay mounted, marked as closing, until their closing
 * animations end, or at once when there are none (reduced motion).
 */
export function WorkLogCollapse({ children }: { children: ReactNode }) {
  const open = Children.toArray(children).length > 0;
  const [kept, setKept] = useState<ReactNode>(open ? children : null);
  if (open && kept !== children) setKept(children);
  // A row that mounts open is simply open. Only a person opening or closing it later moves the
  // rows below, so mounting many rows (a thread switch) measures nothing.
  const [wasOpen, setWasOpen] = useState(open);
  const [toggled, setToggled] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setToggled(true);
  }
  const closing = !open && kept !== null;
  const hostRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops the kept details once their closing animations have ended
  useEffect(() => {
    if (!closing) return;
    const animations = hostRef.current?.getAnimations({ subtree: true }) ?? [];
    if (animations.length === 0) {
      setKept(null);
      return;
    }
    let live = true;
    void Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(
      () => {
        if (live) setKept(null);
      },
    );
    return () => {
      live = false;
    };
  }, [closing]);
  if (kept === null) return null;
  return (
    <ClosingContext value={closing}>
      <ToggledContext value={toggled}>
        <div ref={hostRef} className="contents">
          {open ? children : kept}
        </div>
      </ToggledContext>
    </ClosingContext>
  );
}

export function WorkLogDetails({
  children,
  kind = "text",
  followLive = false,
}: {
  children: ReactNode;
  kind?: "text" | "panel" | "media";

  followLive?: boolean;
}) {
  const closing = use(ClosingContext);
  const toggled = use(ToggledContext);
  const revealRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef<RowsClosing | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the reveal's clip and the rows' slide below it once the row's content is in the DOM
  useLayoutEffect(() => {
    const reveal = revealRef.current;
    if (reveal === null || !toggled) return;
    if (!closing) {
      const wasClosing = closingRef.current;
      closingRef.current = null;
      if (wasClosing?.reopen()) return;
      return openRowsBelow(reveal);
    }
    closingRef.current = closeRowsBelow(reveal);
  }, [closing, toggled]);
  const atLiveEdgeRef = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pins the scroller's scrollTop to the bottom after each commit while following live output
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (followLive && atLiveEdgeRef.current && scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  });
  return (
    <div ref={revealRef} data-one-work-reveal="" data-closing={closing ? "" : undefined}>
      <div>
        <div
          ref={scrollerRef}
          data-one-work-details={kind}
          onScroll={(event) => {
            const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
            atLiveEdgeRef.current = scrollHeight - scrollTop - clientHeight <= LIVE_EDGE_PX;
          }}
          className={cn(
            "cursor-auto",
            kind === "text"
              ? "ms-7 flex max-h-96 flex-col gap-3 overflow-auto px-0.5 py-1 select-text"
              : kind === "panel"
                ? "ms-7 mt-0.5 mb-1.5"
                : "ms-7 mt-1",
          )}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
