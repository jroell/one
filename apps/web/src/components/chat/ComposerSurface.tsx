import { createContext, use, useEffect, useState, type ComponentProps } from "react";

import { cn } from "~/lib/utils";
import { useStableCallback } from "~/hooks/useStableCallback";

const BannerAttachContext = createContext<(() => () => void) | null>(null);

/**
 * An attached banner tells the shell it is there, and the shell shows it as `data-banner-attached`.
 * Styles key on that attribute: a `:has()` on the banner would make the browser re-check the
 * composer each time any node under it changes.
 */
export function useAttachedBannerRegistration(active: boolean) {
  const register = use(BannerAttachContext);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the composer shell that a banner is attached for as long as it is mounted
  useEffect(() => {
    if (!active || !register) return;
    return register();
  }, [active, register]);
}

function Shell({
  contextRow = false,
  className,
  ...props
}: ComponentProps<"div"> & { contextRow?: boolean }) {
  const [attached, setAttached] = useState(0);
  const register = useStableCallback(() => {
    setAttached((count) => count + 1);
    return () => setAttached((count) => count - 1);
  });
  return (
    <BannerAttachContext value={register}>
      <div
        data-slot="composer-shell"
        data-banner-attached={attached > 0 ? "" : undefined}
        data-context-row={contextRow || undefined}
        className={cn(
          "@container/composer-surface group/composer-surface relative isolate mx-auto w-full max-w-(--chat-content-max-width)",
          "[--chat-composer-drawer-inset:1.375rem] [--chat-composer-glass-surface:var(--card)] [--chat-composer-outline:rgb(0_0_0/8%)]",
          "dark:[--chat-composer-glass-surface:var(--surface-raised)] dark:[--chat-composer-highlight:rgb(255_255_255/3%)] dark:[--chat-composer-outline:color-mix(in_srgb,var(--color-white)_5%,transparent)]",
          "[html[data-theme-id]_&]:[--chat-composer-glass-surface:var(--app-theme-surface-raised)] [html[data-theme-id]_&]:[--chat-composer-outline:var(--app-theme-toolbar-border)]",
          "dark:[html[data-theme-id]:not([data-theme-id=t3-chat])_&]:[--chat-composer-highlight:color-mix(in_srgb,var(--app-theme-input)_12%,transparent)] dark:[html[data-theme-id]:not([data-theme-id=t3-chat])_&]:[--chat-composer-outline:color-mix(in_srgb,var(--app-theme-input)_30%,var(--background))]",
          "dark:[html[data-theme-id=t3-chat]_&]:[--chat-composer-highlight:color-mix(in_srgb,#432d48_12%,transparent)] dark:[html[data-theme-id=t3-chat]_&]:[--chat-composer-outline:#241e28]",
          "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:rounded-2xl before:bg-(--chat-composer-glass-surface)/(--glass-opacity) before:backdrop-blur-(--glass-blur) before:backdrop-saturate-(--glass-saturation)",
          "not-supports-[((backdrop-filter:blur(1px))_or_(-webkit-backdrop-filter:blur(1px)))]:before:bg-(--chat-composer-glass-surface)",
          "data-banner-attached:before:hidden",
          // With a context row below, the card paints its own glass (see Host) so the row stays bare.
          "data-context-row:before:hidden",
          className,
        )}
        {...props}
      />
    </BannerAttachContext>
  );
}

const outlineClasses =
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-(--chat-composer-outline) dark:after:inset-shadow-2xs dark:after:inset-shadow-(color:--chat-composer-highlight)";

function Host({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-host"
      data-one-reflect=""
      className={cn(
        "relative z-10 w-full rounded-2xl shadow-composer after:z-1 dark:shadow-none",
        "group-data-context-row/composer-surface:before:pointer-events-none group-data-context-row/composer-surface:before:absolute group-data-context-row/composer-surface:before:inset-0 group-data-context-row/composer-surface:before:-z-1 group-data-context-row/composer-surface:before:rounded-2xl group-data-context-row/composer-surface:before:bg-(--chat-composer-glass-surface)/(--glass-opacity) group-data-context-row/composer-surface:before:backdrop-blur-(--glass-blur) group-data-context-row/composer-surface:before:backdrop-saturate-(--glass-saturation)",
        outlineClasses,
        "group-data-banner-attached/composer-surface:shadow-none group-data-banner-attached/composer-surface:before:hidden group-data-banner-attached/composer-surface:after:hidden",
        className,
      )}
      {...props}
    >
      {children}
      <span aria-hidden="true" className="one-reflection" />
    </div>
  );
}

function Main({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-chat-composer-main-surface="true"
      className={cn(
        "group relative z-10 rounded-2xl p-px",
        outlineClasses,
        "after:z-20 after:hidden group-data-banner-attached/composer-surface:after:block",
        "group-data-banner-attached/composer-surface:bg-(--chat-composer-glass-surface)/(--glass-opacity) group-data-banner-attached/composer-surface:backdrop-blur-(--glass-blur) group-data-banner-attached/composer-surface:backdrop-saturate-(--glass-saturation)",
        "group-data-banner-attached/composer-surface:shadow-composer dark:group-data-banner-attached/composer-surface:shadow-none",
        "not-supports-[((backdrop-filter:blur(1px))_or_(-webkit-backdrop-filter:blur(1px)))]:group-data-banner-attached/composer-surface:bg-(--chat-composer-glass-surface)",
        "group-data-banner-attached/composer-surface:**:data-[chat-composer-mobile-collapsed=true]:min-h-[calc(1rem+1px)]",
        className,
      )}
      {...props}
    />
  );
}

/** A row under the card (environment, worktree, branch); page-coloured glass hides the timeline scrolling behind it. */
function ContextStrip({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-context-strip"
      className={cn(
        "group/composer-context surface-glass relative flex w-full items-center gap-2 overflow-x-clip px-2 pt-2 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export const ComposerSurface = { Shell, Host, Main, ContextStrip };
