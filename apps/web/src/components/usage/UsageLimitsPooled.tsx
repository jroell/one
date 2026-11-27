import {
  CHATGPT_USAGE_URL,
  collectHttpQuotaSources,
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  type LimitAccount,
  type LimitPool,
  type LimitPoolMember,
  type LimitPoolWindow,
  exhaustedUsageWindow,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
  type ResetCreditChoice,
} from "@t3tools/shared/usageLimits";
import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { T, Var, useGT, useMessages } from "gt-react";
import type { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import { AlertTriangleIcon, ExternalLinkIcon, RotateCwIcon, TicketIcon } from "lucide-react";
import {
  createContext,
  Fragment,
  type ReactNode,
  type RefObject,
  use,
  type CSSProperties,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { ensureLocalApi } from "../../localApi";
import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { ExplainControl } from "../settings/explain/ExplainControl";
import { providerClients } from "../settings/providerDriverMeta";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { OpenAI } from "../Icons";
import { Alert, AlertAction, AlertTitle } from "../ui/alert";
import { Popover, PopoverCreateHandle, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ResetCreditDialog, barColor, useResetCredit } from "./UsageLimits";
import { UsageControlsSlot } from "./usageControls";
import { UsageFallbackControl, type UsageFallbackTarget } from "./UsageFallbackControl";
import { LimitMeter } from "./UsageMeter";
import {
  inlineWindowName,
  type LimitCandidate,
  tightestLimit,
  type WindowIdentity,
} from "./usageHeadline";
import { type LimitProjection, limitClock, meterState, projectLimit } from "./usageMeterState";
import {
  collectExternalUsageLinks,
  collectLimitNotices,
  collectLimitSetupPrompts,
  hasUsageSourceWithNoAccounts,
  type LimitSetupPrompt,
  cursorUsageWindowDetails,
  formatDuration,
  formatResetsIn,
  resetCreditChoices,
} from "@t3tools/shared/usageLimitsCopy";

function accountInitials(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local[0] ?? ""}${domain[0] ?? ""}`.toUpperCase() || "?";
}

function accountHue(email: string): number {
  let hash = 0;
  for (let index = 0; index < email.length; index += 1) {
    hash = (hash * 31 + email.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

function AccountChip({ email }: { readonly email: string }) {
  const hue = accountHue(email);
  const gt = useGT();
  return (
    <span
      role="img"
      aria-label={gt("Account {initials}", { initials: accountInitials(email) })}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-3xs leading-none font-semibold"
      style={{ backgroundColor: `oklch(0.85 0.08 ${hue})`, color: `oklch(0.35 0.1 ${hue})` }}
    >
      {accountInitials(email)}
    </span>
  );
}

function AccountAvatar({
  account,
  className,
}: {
  readonly account: LimitAccount;
  readonly className?: string;
}) {
  if (account.redeem) {
    return (
      <ProviderInstanceIcon
        driverKind={account.driver}
        displayName={
          account.displayName ??
          providerClients.get(account.driver)?.label ??
          String(account.driver)
        }
        accentColor={account.accentColor}
        showBadge={Boolean(account.displayName)}
        indicatorBackground="var(--popover)"
        className={cn("size-5", className)}
        iconClassName="usage-mark size-4 text-foreground/80"
      />
    );
  }
  return account.email ? <AccountChip email={account.email} /> : null;
}

function AccountName({
  account,
  className,
}: {
  readonly account: LimitAccount;
  readonly className?: string;
}) {
  if (account.displayName) return <span className={className}>{account.displayName}</span>;
  if (account.email) {
    return (
      <span className={cn("inline-flex min-w-0 items-center", className)}>
        <AccountChip email={account.email} />
      </span>
    );
  }
  return (
    <span className={className}>
      {providerClients.get(account.driver)?.label ?? String(account.driver)}
    </span>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground tabular-nums">{children}</span>
    </div>
  );
}

function SegmentPopover({
  account,
  window,
  reset,
  now,
  redeem,
  onRedeem,
}: {
  readonly account: LimitAccount;
  readonly window: LimitPoolMember["window"];
  readonly reset: LimitPoolWindow["resets"][number] | undefined;
  readonly now: number;
  readonly redeem: ReturnType<typeof useResetCredit> | null;
  readonly onRedeem: (choice: ResetCreditChoice) => void;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const gt = useGT();
  const m = useMessages();
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const resetsIn = formatResetsIn(window, now, m, "in");
  const accountProjection = projectWindow(window, now);
  const where =
    account.environments.length > 0
      ? account.environments.map((environment) => environment.label).join(", ")
      : account.sourceLabel;
  const choices =
    redeem && account.redeem && account.limits.resetCredits?.availableCount
      ? resetCreditChoices(account.limits.resetCredits, account.redeem.input, now, true, m)
      : [];
  return (
    <div className="flex w-72 max-w-[calc(100vw-3rem)] flex-col gap-2.5 text-xs">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <AccountAvatar account={account} />
          <span className="truncate">
            {account.displayName ?? providerClients.get(account.driver)?.label ?? account.driver}
          </span>
        </span>
        {account.email ? (
          <RedactedSensitiveText
            value={account.email}
            ariaLabel={gt("Toggle account email visibility")}
            revealTooltip={gt("Click to reveal email")}
            hideTooltip={gt("Click to hide email")}
            className="w-fit"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1 border-t border-border/60 pt-2.5">
        {account.plan ? (
          <Row label={gt("Plan", { $context: "subscription plan" })}>{account.plan}</Row>
        ) : null}
        {where ? (
          <Row
            label={
              account.environments.length > 0
                ? gt("Signed in")
                : gt("Via", { $context: "signed in through a source" })
            }
          >
            {where}
          </Row>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 border-t border-border/60 pt-2.5">
        <Row label={gt("Left", { $context: "remaining usage" })}>{remaining}%</Row>
        {window.resetsAt ? (
          <Row label={gt("Resets", { $context: "when the usage window resets" })}>
            {formatUpcomingTimestamp(window.resetsAt, timestampFormat, now, undefined, m)}
            {resetsIn ? ` · ${resetsIn}` : ""}
          </Row>
        ) : null}
        {timeLeft !== null ? (
          <Row label={gt("Even pace")}>{gt("{timeLeft}% left by now", { timeLeft })}</Row>
        ) : null}
        {reset && reset.restoresPercent > 0 ? (
          <Row label={gt("Restores", { $context: "a reset credit restores part of the pool" })}>
            {gt("+{percent}% of pool", { percent: reset.restoresPercent })}
          </Row>
        ) : null}
        <ProjectionLine projection={accountProjection} />
      </div>
      {choices.length > 0 && redeem ? (
        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5 text-muted-foreground">
          {choices.map((choice) => (
            <span key={choice.key} className="flex items-center gap-3">
              <span className="tabular-nums">{choice.summary}</span>
              {choice.availableCount > 0 ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={redeem.busy || !redeem.canManageProviders}
                  className="ms-auto"
                  onClick={() => onRedeem(choice)}
                >
                  {redeem.busy ? gt("Using…") : choice.actionLabel}
                </Button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every segment on the page shares one popover, so hovering or clicking another
 * segment moves it instead of opening a second one. The payload is the segment
 * it currently describes.
 */
type SegmentPayload = Omit<Parameters<typeof SegmentPopover>[0], "now" | "onRedeem">;
const SegmentPopoverContext = createContext<ReturnType<
  typeof PopoverCreateHandle<SegmentPayload>
> | null>(null);

function ActiveSegmentPopover({
  handle,
  actions,
  payload,
  pools,
  now,
}: {
  readonly handle: ReturnType<typeof PopoverCreateHandle<SegmentPayload>>;
  readonly actions: RefObject<PopoverPrimitive.Root.Actions | null>;
  readonly payload: SegmentPayload;
  readonly pools: readonly LimitPool[];
  readonly now: number;
}) {
  const available = pools.some((pool) =>
    displayLimitWindows(pool).some((window) =>
      window.members.some(
        (member) =>
          member.account.key === payload.account.key &&
          member.window.id === payload.window.id &&
          member.window.kind === payload.window.kind &&
          Boolean(member.account.redeem) === Boolean(payload.redeem),
      ),
    ),
  );
  // The trigger is gone, so the popup has nothing to anchor to: an exit transition would
  // slide it to the viewport origin. Unmount it outright, which also clears Base UI's
  // active-trigger bookkeeping so the segment can open again when it comes back.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closes the popover handle and unmounts the Base UI popup before paint when its trigger is gone
  useLayoutEffect(() => {
    if (available) return;
    handle.close();
    actions.current?.unmount();
  }, [available, handle, actions]);
  return (
    <PopoverPopup side="top" sideOffset={6}>
      <SegmentPopover
        {...payload}
        now={now}
        onRedeem={(choice) => {
          handle.close();
          payload.redeem?.confirm(choice);
        }}
      />
    </PopoverPopup>
  );
}

/**
 * The confirm is a sibling of the popover, not a child: dialogs stack under
 * popovers, and the popover closes as the confirm opens.
 */
function PoolSegment({
  account,
  ...props
}: {
  readonly account: LimitAccount;
  readonly window: LimitPoolMember["window"];
  readonly reset: LimitPoolWindow["resets"][number] | undefined;
  readonly color: string;
  readonly now: number;
  readonly index: number;
  readonly showAccountName: boolean;
}) {
  return account.redeem ? (
    <RedeemableSegment account={account} redeemAt={account.redeem} {...props} />
  ) : (
    <SegmentTriggers account={account} redeem={null} {...props} />
  );
}

function RedeemableSegment({
  redeemAt,
  ...props
}: Omit<Parameters<typeof SegmentTriggers>[0], "redeem"> & {
  readonly redeemAt: NonNullable<LimitAccount["redeem"]>;
}) {
  const redeem = useResetCredit(redeemAt.environmentId);
  const gt = useGT();
  return (
    <>
      <SegmentTriggers redeem={redeem} {...props} />
      <ResetCreditDialog
        open={redeem.confirming}
        onOpenChange={redeem.setConfirming}
        choice={redeem.choice}
        onConfirm={() => void redeem.redeem()}
        disabled={!redeem.canManageProviders}
      />
      {/* The popover closed before the confirm, so progress and the outcome need a home outside it. */}
      {redeem.busy || redeem.status ? (
        <span role="status" className="col-span-full text-xs text-muted-foreground">
          <AccountName account={props.account} className="font-medium text-foreground" />{" "}
          {redeem.busy ? gt("Using reset credit…") : redeem.status}
        </span>
      ) : null}
    </>
  );
}

function SegmentTriggers({
  account,
  window,
  reset,
  redeem,
  color,
  now,
  index,
  showAccountName,
}: SegmentPayload & {
  readonly color: string;
  readonly now: number;
  readonly index: number;
  readonly showAccountName: boolean;
}) {
  const popover = use(SegmentPopoverContext) ?? undefined;
  const payload: SegmentPayload = { account, window, reset, redeem };
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const m = useMessages();
  const resetsIn = formatResetsIn(window, now, m);
  const refillIn = formatResetsIn(window, now, m, "refill");
  const credits = account.limits.resetCredits?.availableCount ?? 0;
  const gt = useGT();
  const name =
    account.displayName ?? (account.email ? accountInitials(account.email) : account.driver);
  const segmentLabel = [
    gt("{name}: {remaining}% left", { name, remaining }),
    resetsIn,
    timeLeft === null ? null : gt("{timeLeft}% of the window left", { timeLeft }),
    credits
      ? gt(
          "{count, plural, one {{count} reset credit banked} other {{count} reset credits banked}}",
          { count: credits },
        )
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <>
      <div
        className="usage-seg"
        data-named={showAccountName ? "" : undefined}
        style={{ gridColumn: index, gridRow: 1 }}
      >
        <LimitMeter
          remaining={remaining}
          timeLeft={timeLeft}
          pace={paceOf(window, now)}
          color={color}
          label={showAccountName ? name : window.label}
        />
        {showAccountName ? (
          <div aria-hidden className="usage-seg-caption">
            <span className="usage-seg-index">{index}</span>
            <span className="usage-seg-name">
              <AccountName account={account} className="min-w-0 truncate font-medium" />
              <span className="usage-seg-percent">{remaining}%</span>
            </span>
            {resetsIn || credits ? (
              <span className="usage-seg-meta">
                {refillIn ?? ""}
                {credits ? (
                  <>
                    {resetsIn ? <span aria-hidden>·</span> : null}
                    <span aria-hidden className="inline-flex items-center gap-1 font-semibold">
                      <TicketIcon className="size-3" aria-hidden />
                      {gt("{count, plural, one {{count} credit} other {{count} credits}}", {
                        count: credits,
                      })}
                    </span>
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}
        <PopoverTrigger
          handle={popover}
          payload={payload}
          openOnHover
          render={<button type="button" aria-label={segmentLabel} className="usage-seg-hit" />}
        />
      </div>
      {showAccountName ? (
        <LegendRow payload={payload} color={color} now={now} index={index} />
      ) : null}
    </>
  );
}

function LegendRow({
  payload,
  color,
  now,
  index,
}: {
  readonly payload: SegmentPayload;
  readonly color: string;
  readonly now: number;
  readonly index: number;
}) {
  const popover = use(SegmentPopoverContext) ?? undefined;
  const { account, window } = payload;
  const remaining = remainingPercent(window);
  const m = useMessages();
  const resetsIn = formatResetsIn(window, now, m, "refill");
  const credits = account.limits.resetCredits?.availableCount ?? 0;
  const gt = useGT();
  return (
    <PopoverTrigger
      handle={popover}
      payload={payload}
      style={{ gridColumn: "1 / -1", gridRow: index + 1 }}
      render={<button type="button" className="usage-legend" />}
    >
      <span className="usage-legend-badge" style={{ "--usage-accent": color } as CSSProperties}>
        <span className="sr-only">{`${gt("Segment")} `}</span>
        <span>{index}</span>
      </span>
      <AccountName account={account} className="min-w-0 truncate font-medium text-foreground" />
      <span className="shrink-0 font-semibold text-foreground tabular-nums">{remaining}%</span>
      <span className="ms-auto flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground tabular-nums">
        {resetsIn ?? ""}
        {credits ? (
          <>
            {resetsIn ? <span aria-hidden>·</span> : null}
            <span
              aria-hidden
              className="inline-flex items-center gap-1 font-semibold text-foreground"
            >
              <TicketIcon className="size-3" aria-hidden />
              {gt("{count, plural, one {{count} credit} other {{count} credits}}", {
                count: credits,
              })}
            </span>
            <span className="sr-only">
              {gt(
                "{count, plural, one {{count} reset credit banked} other {{count} reset credits banked}}",
                { count: credits },
              )}
            </span>
          </>
        ) : null}
      </span>
    </PopoverTrigger>
  );
}

/** A $0 spend cap has no percentage, so no fill: an empty channel with its account and its cap. */
function ZeroCapSegment({
  account,
  color,
  index,
}: {
  readonly account: LimitAccount;
  readonly color: string;
  readonly index: number;
}) {
  const gt = useGT();
  return (
    <>
      <div className="usage-seg" data-named style={{ gridColumn: index, gridRow: 1 }}>
        <div aria-hidden className="usage-seg-empty" />
        <div className="usage-seg-caption">
          <span aria-hidden className="usage-seg-index">
            {index}
          </span>
          <span className="usage-seg-name">
            <AccountName account={account} className="min-w-0 truncate font-medium" />
            <span className="usage-seg-percent">{gt("$0 cap")}</span>
          </span>
        </div>
      </div>
      <div
        className="usage-legend usage-legend-static"
        style={{ gridColumn: "1 / -1", gridRow: index + 1 }}
      >
        <span className="usage-legend-badge" style={{ "--usage-accent": color } as CSSProperties}>
          <span className="sr-only">{`${gt("Segment")} `}</span>
          <span>{index}</span>
        </span>
        <AccountName account={account} className="min-w-0 truncate font-medium text-foreground" />
        <span className="shrink-0 font-semibold text-foreground">{gt("$0 cap")}</span>
      </div>
    </>
  );
}

function PoolBar({
  pool,
  color,
  now,
}: {
  readonly pool: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
}) {
  const restores = new Map(pool.resets.map((reset) => [reset.member.account.key, reset]));
  return (
    <div className="usage-bar">
      <div
        className="usage-bar-grid"
        style={{ gridTemplateColumns: `repeat(${pool.columns.length}, minmax(0, 1fr))` }}
      >
        {pool.columns.map((member, position) =>
          member.window ? (
            <PoolSegment
              key={member.account.key}
              account={member.account}
              window={member.window}
              reset={restores.get(member.account.key)}
              color={normalizeProviderAccentColor(member.account.accentColor) ?? color}
              now={now}
              index={position + 1}
              showAccountName={pool.columns.length > 1}
            />
          ) : pool.kind === "monthly" && member.account.limits.zeroSpendCap ? (
            <ZeroCapSegment
              key={member.account.key}
              account={member.account}
              color={normalizeProviderAccentColor(member.account.accentColor) ?? color}
              index={position + 1}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}

/** Where one account's window is heading at its own pace, on its own clock. */
function projectWindow(window: ServerProviderUsageWindow, now: number): LimitProjection {
  const clock = limitClock([window], now);
  return projectLimit({
    usedPercent: window.usedPercent,
    windowMs: clock?.windowMs ?? null,
    msToReset: clock?.msToReset ?? null,
  });
}

/**
 * A pool's forecast exists only when its accounts share one reset model (`limitClock`); otherwise
 * each account's own forecast stands in its segment and no pooled sentence is made up.
 */
function projectPool(pool: LimitPoolWindow, now: number): LimitProjection {
  const clock = limitClock(
    pool.members.map((member) => member.window),
    now,
  );
  return projectLimit({
    usedPercent: pool.usedPercent,
    windowMs: clock?.windowMs ?? null,
    msToReset: clock?.msToReset ?? null,
  });
}

/** Time to the next real reset: the first refill that restores something, else the first reset. */
function nextResetMs(pool: LimitPoolWindow, now: number): number | null {
  const next =
    pool.resets.find((reset) => reset.at > now && reset.restoresPercent > 0) ??
    pool.resets.find((reset) => reset.at > now);
  return next === undefined ? null : next.at - now;
}

/** The encoding, said once under the first meter: what the fill, the tick and the hatching mean. */
function MeterLegend() {
  const gt = useGT();
  return (
    <p className="usage-key">
      <span className="usage-key-item">
        <span aria-hidden className="usage-key-fill" />
        {gt("Quota left")}
      </span>
      <span className="usage-key-item">
        <span aria-hidden className="usage-key-tick" />
        {gt("Even pace")}
      </span>
      <span className="usage-key-item">
        <span aria-hidden className="usage-key-hatch" />
        {gt("Shortfall")}
      </span>
    </p>
  );
}

function ProjectionLine({ projection }: { readonly projection: LimitProjection }) {
  const m = useMessages();
  switch (projection.kind) {
    case "runs-out":
      return (
        <p className="usage-projection">
          <T>
            At this pace it runs out in{" "}
            <span className="usage-projection-warn">
              <Var>{formatDuration(projection.runsOutInMs, m)}</Var>
            </span>
            , <Var>{formatDuration(projection.beforeResetMs, m)}</Var> before the reset.
          </T>
        </p>
      );
    case "on-track":
      return (
        <p className="usage-projection">
          <T>On track to last until the reset.</T>
        </p>
      );
    case "plenty":
      return (
        <p className="usage-projection">
          <T>Plenty left for this window.</T>
        </p>
      );
    case "exhausted":
      return (
        <p className="usage-projection">
          <T>Used up until the reset.</T>
        </p>
      );
    case "none":
      return null;
  }
}

function PoolWindowCard({
  pool,
  color,
  now,
  label,
  description,
  row,
}: {
  readonly pool: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
  readonly label?: string | null | undefined;
  readonly description?: string | undefined;
  /** Position on the page, for the entrance stagger. */
  readonly row: number;
}) {
  const m = useMessages();
  const gt = useGT();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const nextRefill = pool.resets.find((reset) => reset.at > now && reset.restoresPercent > 0);
  // A lone account has no segment caption, so its reset time and credits sit under the meter.
  const first = pool.columns[0];
  const lone = pool.columns.length === 1 && first?.window ? first : undefined;
  const loneWindow = lone?.window ?? null;
  const resetsIn = loneWindow ? formatResetsIn(loneWindow, now, m) : null;
  const resetsAt = loneWindow?.resetsAt
    ? formatUpcomingTimestamp(loneWindow.resetsAt, timestampFormat, now, undefined, m)
    : null;
  const resetsAtIn = loneWindow ? formatResetsIn(loneWindow, now, m, "in") : null;
  const credits = lone?.account.limits.resetCredits?.availableCount ?? 0;
  const creditsLabel = gt(
    "{count, plural, one {{count} reset credit banked. Use it to refill this limit now, before its window ends.} other {{count} reset credits banked. Use one to refill this limit now, before its window ends.}}",
    { count: credits },
  );
  const creditsShort = gt("{count, plural, one {{count} credit} other {{count} credits}}", {
    count: credits,
  });
  const projection = projectPool(pool, now);
  const name = label === null ? null : (label ?? pool.label);
  return (
    <div
      className="usage-limit"
      data-state={meterState(pool.remainingPercent)}
      style={{ "--usage-row": row } as CSSProperties}
    >
      <div className="usage-limit-lead">
        {name ? <span className="usage-limit-label">{name}</span> : null}
        <span className="usage-limit-figure">
          <span className="usage-limit-number">{pool.remainingPercent}%</span>
          <span className="usage-limit-unit">
            <span>
              <T context="remaining usage percentage">left</T>
            </span>
            {name ? <span className="usage-limit-name">{name}</span> : null}
          </span>
        </span>
        {projection.kind === "runs-out" ? (
          <Tooltip>
            <TooltipTrigger render={<span className="usage-pace-chip" tabIndex={0} />}>
              {gt("Runs out early")}
            </TooltipTrigger>
            <TooltipPopup side="top">
              {gt("Compared with how much of the window has passed")}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {nextRefill && pool.columns.length > 1 ? (
          <span className="usage-limit-refill">
            <T context="usage limit refill">
              <span className="font-medium text-foreground">
                ↻ +<Var>{nextRefill.restoresPercent}</Var>%
              </span>{" "}
              in <Var>{formatDuration(nextRefill.at - now, m)}</Var>
            </T>
          </span>
        ) : null}
      </div>
      <div className="usage-limit-body">
        <PoolBar pool={pool} color={color} now={now} />
        {projection.kind !== "none" || resetsIn || credits > 0 ? (
          <div className="usage-limit-foot">
            <ProjectionLine projection={projection} />
            {resetsIn || credits > 0 ? (
              <div className="usage-meta">
                {resetsIn ? (
                  <Tooltip>
                    <TooltipTrigger render={<span className="usage-meta-item" tabIndex={0} />}>
                      <RotateCwIcon aria-hidden />
                      {resetsIn}
                    </TooltipTrigger>
                    {resetsAt ? (
                      <TooltipPopup side="top">
                        {resetsAtIn
                          ? gt("Resets {resetsAt} · {resetsIn}", {
                              resetsAt,
                              resetsIn: resetsAtIn,
                            })
                          : gt("Resets {resetsAt}", { resetsAt })}
                      </TooltipPopup>
                    ) : null}
                  </Tooltip>
                ) : null}
                {credits > 0 ? (
                  <Tooltip>
                    <TooltipTrigger render={<span className="usage-meta-item" tabIndex={0} />}>
                      <TicketIcon aria-hidden />
                      {creditsShort}
                    </TooltipTrigger>
                    <TooltipPopup side="top">{creditsLabel}</TooltipPopup>
                  </Tooltip>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {row === 0 ? <MeterLegend /> : null}
      </div>
      {description ? <p className="usage-limit-note">{description}</p> : null}
    </div>
  );
}

function PoolSection({
  pool,
  now,
  rowOffset,
  fallbackTargets,
}: {
  readonly pool: LimitPool;
  readonly now: number;
  readonly rowOffset: number;
  /** Where a standing fallback model can be set for a provider that is out, by driver. */
  readonly fallbackTargets: ReadonlyMap<string, UsageFallbackTarget>;
}) {
  const color = barColor(pool.driver);
  const label = providerClients.get(pool.driver)?.label ?? String(pool.driver);
  const windows = displayLimitWindows(pool);
  const m = useMessages();
  return (
    <section className="usage-panel">
      <h2 className="usage-panel-head">
        <ProviderInstanceIcon
          driverKind={pool.driver}
          displayName={label}
          indicatorBackground="var(--background)"
          className="usage-mark size-5"
          iconClassName="size-4 text-foreground/80"
        />
        {label}
      </h2>
      {windows.map((window, position) => {
        const details =
          pool.driver === "cursor" ? cursorUsageWindowDetails(window.id, pool, m) : undefined;
        return (
          <PoolWindowCard
            key={`${window.kind}:${window.id}`}
            pool={window}
            color={color}
            now={now}
            label={details?.label}
            description={details?.description}
            row={rowOffset + position}
          />
        );
      })}
      {fallbackTargets.get(pool.driver) ? (
        <UsageFallbackControl target={fallbackTargets.get(pool.driver)!} now={now} />
      ) : null}
    </section>
  );
}

/** Same panel, head and rows as a loaded provider, so the page does not move when limits arrive. */
function LimitsSkeleton() {
  return (
    <section className="usage-panel">
      <p role="status" className="usage-skeleton-note">
        <T>Reading limits from your providers…</T>
      </p>
      <div className="usage-panel-head" aria-hidden>
        <Skeleton shape="pill" className="size-5" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="usage-limit" aria-hidden>
        <div className="usage-limit-lead">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-10 w-28" />
        </div>
        <div className="usage-limit-body">
          <div className="usage-skeleton-channel">
            <Skeleton shape="pill" className="h-full w-full" />
          </div>
          <div className="usage-meta">
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </div>
    </section>
  );
}

interface WatchedLimit {
  readonly provider: string;
  readonly window: WindowIdentity;
  readonly remainingPercent: number;
  /** Time to the next real reset, when the limit reports one. */
  readonly resetInMs: number | null;
}

type QuotaSources = ReturnType<typeof collectHttpQuotaSources>;

/** Every limit the page shows, native pools and HTTP quota windows alike. */
/**
 * The quota left before any rounding, for ranking. A pool of several accounts has no unrounded
 * figure, so one that rounds to 0% is placed just above empty unless every account is spent.
 */
function rawRemainingPercent(
  members: readonly ServerProviderUsageWindow[],
  rounded: number,
): number {
  const left = (window: ServerProviderUsageWindow) =>
    100 - Math.max(0, Math.min(100, window.usedPercent));
  if (members.every((window) => left(window) <= 0)) return 0;
  const [only] = members;
  if (members.length === 1 && only !== undefined) return left(only);
  return rounded === 0 ? Number.EPSILON : rounded;
}

function watchableLimits(
  pools: readonly LimitPool[],
  quotaSources: QuotaSources,
  now: number,
): readonly LimitCandidate<WatchedLimit>[] {
  const fromPools = pools.flatMap((pool) =>
    displayLimitWindows(pool).map((window): LimitCandidate<WatchedLimit> => ({
      subject: {
        provider: providerClients.get(pool.driver)?.label ?? String(pool.driver),
        // A Codex pool is keyed by kind, so the reported window's own id is its first member's.
        window: {
          id: window.members[0]?.window.id ?? window.id,
          kind: window.kind,
          label: window.label,
          native: true,
        },
        remainingPercent: window.remainingPercent,
        resetInMs: nextResetMs(window, now),
      },
      remainingPercent: rawRemainingPercent(
        window.members.map((member) => member.window),
        window.remainingPercent,
      ),
      projection: projectPool(window, now),
    })),
  );
  const fromQuotas = quotaSources.flatMap((source) =>
    (source.quotaAccounts ?? []).flatMap((account) =>
      account.windows.map((window): LimitCandidate<WatchedLimit> => {
        const resetAt = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
        return {
          subject: {
            provider: source.label,
            // An external quota's label is its source's own: never rewritten.
            window: { id: window.id, kind: window.kind, label: window.label, native: false },
            remainingPercent: remainingPercent(window),
            resetInMs: resetAt > now ? resetAt - now : null,
          },
          remainingPercent: rawRemainingPercent([window], remainingPercent(window)),
          projection: projectWindow(window as ServerProviderUsageWindow, now),
        };
      }),
    ),
  );
  return [...fromPools, ...fromQuotas];
}

/** The page's headline: the limit to watch across everything shown, in words. Text, not a card. */
function LimitsSummary({
  pools,
  quotaSources,
  now,
}: {
  readonly pools: readonly LimitPool[];
  readonly quotaSources: QuotaSources;
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const candidates = watchableLimits(pools, quotaSources, now);
  const tightest = tightestLimit(candidates);
  if (tightest === undefined) return null;
  const { provider, window, resetInMs } = tightest.subject;
  const watching =
    tightest.projection.kind === "runs-out" ||
    tightest.projection.kind === "exhausted" ||
    meterState(tightest.remainingPercent) !== "comfortable";
  const parts = {
    provider,
    window: inlineWindowName(window, m),
    remaining: tightest.subject.remainingPercent,
  };
  const headline = !watching
    ? gt("All limits are comfortable.")
    : resetInMs === null
      ? gt("{provider} {window} is the one to watch: {remaining}% left.", parts)
      : gt("{provider} {window} is the one to watch: {remaining}% left, {duration} to go.", {
          ...parts,
          duration: formatDuration(resetInMs, m),
        });
  const providers =
    pools.length +
    quotaSources.filter((source) =>
      source.quotaAccounts?.some((account) => account.windows.length > 0),
    ).length;
  return (
    <header className="usage-headline-block">
      <h2 className="usage-headline">{headline}</h2>
      <p className="usage-count">
        {gt(
          "{limits, plural, one {{limits} limit} other {{limits} limits}} across {providers, plural, one {{providers} provider} other {{providers} providers}}",
          { limits: candidates.length, providers },
        )}
      </p>
    </header>
  );
}

export function UsageLimitsPooled({
  presentations,
  now,
  loading = false,
  onRetry,
}: {
  readonly presentations: Parameters<typeof collectLimitAccounts>[0];
  readonly now: number;
  /** A refresh is running; with nothing to show yet, the page says so instead of reporting none. */
  readonly loading?: boolean;
  /** Reads the limits again. */
  readonly onRetry?: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const [segmentPopover] = useState(() => PopoverCreateHandle<SegmentPayload>());
  const segmentPopoverActions = useRef<PopoverPrimitive.Root.Actions | null>(null);
  const pools = collectLimitPools(collectLimitAccounts(presentations), now);
  const quotaSources = collectHttpQuotaSources(presentations);
  const fallbackTargets = new Map<string, UsageFallbackTarget>(
    [...presentations].flatMap(([environmentId, presentation]) => {
      const providers = presentation.serverConfig?.providers ?? [];
      const exhausted = providers.find((provider) => exhaustedUsageWindow(provider, now));
      return exhausted
        ? [[exhausted.driver, { environmentId, exhausted, providers }] as const]
        : [];
    }),
  );
  const setupPrompts = collectLimitSetupPrompts(presentations);
  const notices = collectLimitNotices(presentations, m, { withoutSetupPrompts: true });
  const externalLinks = collectExternalUsageLinks(presentations, m);
  const rowCounts = pools.map((pool) => displayLimitWindows(pool).length);
  return (
    <div className="usage-stack usage-limits" aria-busy={loading}>
      <LimitsSummary pools={pools} quotaSources={quotaSources} now={now} />
      <UsageControlsSlot />
      {pools.length === 0 &&
      notices.length === 0 &&
      setupPrompts.length === 0 &&
      externalLinks.length === 0 &&
      quotaSources.length === 0 ? (
        loading ? (
          <LimitsSkeleton />
        ) : (
          <p className="usage-empty">
            <T>No provider on the selected environments reports subscription limits.</T>
          </p>
        )
      ) : null}
      <SegmentPopoverContext value={segmentPopover}>
        {pools.map((pool, position) => (
          <Fragment key={pool.driver}>
            <PoolSection
              pool={pool}
              now={now}
              rowOffset={rowCounts.slice(0, position).reduce((sum, count) => sum + count, 0)}
              fallbackTargets={fallbackTargets}
            />
          </Fragment>
        ))}
      </SegmentPopoverContext>
      {setupPrompts.map((prompt) => (
        <LimitSetupRow key={prompt.key} prompt={prompt} showEnvironment={presentations.size > 1} />
      ))}
      <Popover handle={segmentPopover} actionsRef={segmentPopoverActions}>
        {({ payload }) =>
          payload ? (
            <ActiveSegmentPopover
              handle={segmentPopover}
              actions={segmentPopoverActions}
              payload={payload}
              pools={pools}
              now={now}
            />
          ) : null
        }
      </Popover>
      {quotaSources.map((source) => (
        <section key={source.key} className="usage-panel usage-panel-plain space-y-3">
          <h2 className="text-sm font-medium">{source.label}</h2>
          {source.quotaAccounts?.map((account) => (
            <div key={account.id} className="space-y-1">
              <h3 className="text-sm font-medium">{account.label}</h3>
              {account.windows.map((window) => {
                const reset = formatResetsIn(window, now, m);
                return (
                  <div
                    key={window.id}
                    className="flex justify-between gap-3 text-sm text-muted-foreground"
                  >
                    <span>{window.label}</span>
                    <span>
                      {gt("{remaining}% left", { remaining: remainingPercent(window) })}
                      {reset ? ` · ${reset}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      ))}
      {externalLinks.map((link) => (
        <section
          key={link.url}
          className="usage-panel usage-panel-plain flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {link.url === CHATGPT_USAGE_URL ? (
              <OpenAI className="size-5 shrink-0" aria-hidden="true" />
            ) : null}
            <div className="min-w-0 space-y-1">
              <h2 className="text-sm font-medium">{link.label}</h2>
              <p className="text-xs break-words text-muted-foreground">
                {link.accounts.join(", ")}
              </p>
              {link.url === CHATGPT_USAGE_URL ? (
                <p className="text-xs text-muted-foreground">
                  <T>View usage in ChatGPT with your connected account.</T>
                </p>
              ) : link.message ? (
                <p className="max-w-xl text-xs text-muted-foreground">{link.message}</p>
              ) : null}
            </div>
          </div>
          <Button
            variant="ghost-muted"
            size="xs"
            onClick={() => void ensureLocalApi().shell.openExternal(link.url)}
          >
            {gt("Manage usage")}
            <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </section>
      ))}
      <LimitNotices
        notices={notices}
        explainNoAccounts={hasUsageSourceWithNoAccounts(presentations)}
        {...(onRetry ? { onRetry } : {})}
      />
    </div>
  );
}

/**
 * A provider whose limits wait on setup. Signing in is a flow of its own (a browser page, a code or
 * a terminal, kept by the provider's page in Settings), so the button opens that page for this
 * provider on this machine instead of starting a second flow here.
 */
function LimitSetupRow({
  prompt,
  showEnvironment,
}: {
  readonly prompt: LimitSetupPrompt;
  readonly showEnvironment: boolean;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const label = providerClients.get(prompt.driver)?.label ?? prompt.name;
  return (
    <section className="usage-panel" data-usage-setup={prompt.driver}>
      <h2 className="usage-panel-head">
        <ProviderInstanceIcon
          driverKind={prompt.driver}
          displayName={label}
          indicatorBackground="var(--background)"
          className="usage-mark size-5"
          iconClassName="size-4 text-foreground/80"
        />
        {label}
      </h2>
      <div className="usage-setup-body">
        <p className="usage-setup-text">
          <span>
            {showEnvironment
              ? gt("Sign in to see limits on {environment}.", {
                  environment: prompt.environmentLabel,
                })
              : gt("Sign in to see limits.")}
          </span>{" "}
          <ExplainControl topic="usage-sign-in" returnLabel={gt("Usage")} />
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void navigate({
              to: "/settings/providers",
              search: {
                environmentId: prompt.environmentId,
                instanceId: prompt.instanceId,
                action: "sign-in",
              },
            })
          }
        >
          {gt("Sign in with Google")}
        </Button>
      </div>
    </section>
  );
}

function LimitNotices({
  notices,
  explainNoAccounts,
  onRetry,
}: {
  readonly notices: readonly string[];
  readonly explainNoAccounts: boolean;
  readonly onRetry?: () => void;
}) {
  const gt = useGT();
  if (notices.length === 0) return null;
  return (
    <Alert variant="warning" controlAlignment="first-line">
      <AlertTriangleIcon />
      {notices.map((notice) => (
        <AlertTitle key={notice} className="break-words">
          {notice}
        </AlertTitle>
      ))}
      {onRetry || explainNoAccounts ? (
        <AlertAction>
          {explainNoAccounts ? (
            <ExplainControl topic="usage-no-accounts" returnLabel={gt("Usage")} />
          ) : null}
          {onRetry ? (
            <Button variant="outline" size="xs" onClick={onRetry}>
              {gt("Retry")}
            </Button>
          ) : null}
        </AlertAction>
      ) : null}
    </Alert>
  );
}
