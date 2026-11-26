import {
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
  type RuntimeRequestId,
} from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";
import { memo } from "react";
import { ChevronDownIcon, EllipsisIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import {
  clearApprovalDecision,
  noteApprovalDecision,
  useApprovalDecision,
} from "~/one/approvalDecision";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { composerFloatingLayerProps } from "./composerEventScope";

interface ComposerPendingApprovalActionsProps {
  presentation?: "composer" | "inline" | "card";
  requestId: RuntimeRequestId;
  isResponding: boolean;
  canRespond: boolean;
  disabled?: boolean;
  options?: ReadonlyArray<ProviderApprovalOption> | undefined;
  /** The key hints a card shows beside Approve and Decline, when those chords act on it. */
  shortcuts?: { readonly accept?: string | null; readonly decline?: string | null } | undefined;
  onRespondToApproval: (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

const DEFAULT_APPROVAL_OPTIONS = [
  {
    decision: "cancel",
    label: msg("Cancel the turn", { $context: "verb, response to an approval request" }),
  },
  {
    decision: "decline",
    label: msg("Decline", { $context: "verb, response to an approval request" }),
  },
  { decision: "acceptForSession", label: msg("Allow for the rest of this session") },
  {
    decision: "accept",
    label: msg("Approve", { $context: "verb, response to an approval request" }),
  },
] satisfies ReadonlyArray<ProviderApprovalOption>;

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  presentation = "composer",
  requestId,
  isResponding,
  canRespond,
  disabled = false,
  options = DEFAULT_APPROVAL_OPTIONS,
  shortcuts,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const gt = useGT();
  const pressed = useApprovalDecision(requestId);
  const m = useMessages();
  // Provider options carry server-authored labels; only the built-in defaults are translated.
  const optionLabel = (label: string) => (options === DEFAULT_APPROVAL_OPTIONS ? m(label) : label);
  const primaryOptions = options.filter(
    (option) => option.decision === "decline" || option.decision === "accept",
  );
  const moreOptions = options.filter(
    (option) => option.decision !== "decline" && option.decision !== "accept",
  );

  const card = presentation === "card";
  const primaryButtons = primaryOptions.map((option) => {
    // The pressed button keeps full contrast and says what is happening; the rest dim.
    const pending = card && isResponding && pressed === option.decision;
    const hint =
      card && !isResponding
        ? option.decision === "accept"
          ? shortcuts?.accept
          : option.decision === "decline"
            ? shortcuts?.decline
            : null
        : null;
    const buttonProps = {
      disabled: pending ? false : disabled || isResponding || !canRespond,
      ...(pending ? { "aria-disabled": true, "data-pending": "" } : {}),
      "aria-description": option.warning,
      // The visible key hint is decoration, so the button keeps its plain name.
      ...(hint ? { "aria-label": optionLabel(option.label) } : {}),
      onClick: () => {
        if (!disabled && !isResponding && canRespond) {
          noteApprovalDecision(requestId, option.decision);
          // A refused answer leaves the card pending, so it must not stay marked as pressed.
          void Promise.resolve(onRespondToApproval(requestId, option.decision)).catch(() =>
            clearApprovalDecision(requestId),
          );
        }
      },
    };
    const content = (
      <>
        {option.warning ? <TriangleAlertIcon className="size-3 shrink-0" /> : null}
        <span className={presentation === "composer" ? "max-w-40 truncate" : "whitespace-normal"}>
          {pending
            ? option.decision === "accept"
              ? gt("Approving…")
              : gt("Declining…")
            : optionLabel(option.label)}
        </span>
        {hint ? (
          <Kbd aria-hidden data-approval-hint="">
            {hint}
          </Kbd>
        ) : null}
      </>
    );
    const button = (
      <Button
        key={option.decision}
        {...buttonProps}
        size={card ? "default" : presentation === "inline" ? "sm-multiline" : "xs"}
        variant={option.decision === "accept" ? "default" : card ? "secondary" : "outline"}
      >
        {content}
      </Button>
    );
    return option.warning ? (
      <Tooltip key={option.decision}>
        <TooltipTrigger render={button} />
        <TooltipPopup side="top">{option.warning}</TooltipPopup>
      </Tooltip>
    ) : (
      button
    );
  });
  const moreMenu =
    moreOptions.length > 0 ? (
      <Menu>
        <MenuTrigger
          disabled={disabled || isResponding || !canRespond}
          render={
            presentation !== "composer" ? (
              <Button
                size={card ? "default" : "sm-multiline"}
                variant="ghost-muted"
                aria-label={gt("More approval options")}
              />
            ) : (
              <Button size="icon-xs" variant="outline" aria-label={gt("More approval options")} />
            )
          }
        >
          {presentation !== "composer" ? (
            <>
              {gt("More", { $context: "button that opens more approval options" })}
              <ChevronDownIcon aria-hidden className="size-3" />
            </>
          ) : (
            <EllipsisIcon />
          )}
        </MenuTrigger>
        <MenuPopup {...composerFloatingLayerProps} side="top" align="end" width="content">
          {moreOptions.map((option) => {
            const item = (
              <MenuItem
                key={option.decision}
                disabled={disabled || isResponding || !canRespond}
                aria-description={option.warning}
                onClick={() => {
                  if (!disabled && !isResponding && canRespond)
                    void onRespondToApproval(requestId, option.decision);
                }}
              >
                {option.warning ? <TriangleAlertIcon className="size-3 text-warning" /> : null}
                <span className="min-w-0 whitespace-normal wrap-break-word">
                  {optionLabel(option.label)}
                </span>
              </MenuItem>
            );
            return option.warning ? (
              <Tooltip key={option.decision}>
                <TooltipTrigger render={item} />
                <TooltipPopup side="top">{option.warning}</TooltipPopup>
              </Tooltip>
            ) : (
              item
            );
          })}
        </MenuPopup>
      </Menu>
    ) : null;
  return card ? (
    <>
      {moreMenu}
      {primaryButtons}
    </>
  ) : (
    <>
      {primaryButtons}
      {moreMenu}
    </>
  );
});
