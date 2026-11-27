import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { exhaustedUsageWindow } from "@t3tools/shared/usageLimits";
import { useGT } from "gt-react";
import type { ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useEnvironmentProviders } from "../../state/environments";
import { UsageFallbackControl } from "../usage/UsageFallbackControl";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

/**
 * The "Limited" status word of a thread whose provider is out of usage, opening the same action
 * the Usage page offers: switch new threads to another ready provider until it resets.
 */
export function LimitedFallbackPopover(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const providers = useEnvironmentProviders().get(props.environmentId);
  const now = Date.parse(`${useNowMinute()}:00.000Z`);
  const exhausted = providers?.find(
    (provider) => provider.instanceId === props.instanceId && exhaustedUsageWindow(provider, now),
  );
  if (!providers || !exhausted) return props.children;
  return (
    <Popover>
      <PopoverTrigger
        render={<button type="button" className="inline-flex cursor-pointer items-center" />}
        aria-label={gt("Usage limit: what to do")}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {props.children}
      </PopoverTrigger>
      <PopoverPopup side="right">
        {/* The popup sits in the row's React tree, so its clicks would open the thread. */}
        <div
          role="presentation"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <UsageFallbackControl
            compact
            now={now}
            target={{ environmentId: props.environmentId, exhausted, providers }}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}
