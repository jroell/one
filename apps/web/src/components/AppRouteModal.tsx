import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { T, useGT } from "gt-react";
import { XIcon } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { getCommandPaletteOpener } from "../commandPaletteStore";
import { useNativeTitlebarHeight } from "../lib/windowControlsOverlay";
import { requestWorkspaceFocus } from "../lib/workspaceFocus";
import { useCloseAppModal } from "./sidebar/mainAppLocation";
import { GlobalVoiceInputIndicator } from "./chat/GlobalVoiceInputIndicator";
import { Button } from "./ui/button";
import { DialogBackdrop } from "./ui/dialog";
import { Skeleton } from "./ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * Large modal for the Settings and Usage routes. Esc, the close button, or a press on the
 * backdrop returns to the page that opened it. Keyboard guards that skip dialogs exempt
 * `[data-app-modal]`, because these pages own their shortcuts.
 */
export function AppRouteModal({
  label,
  actionsRef,
  onEscape,
  skeleton,
  children,
}: {
  label: string;
  /** The outline shown, only if the page takes over 250 ms, in the page's own layout. */
  skeleton?: ReactNode;
  actionsRef?: RefObject<DialogPrimitive.Root.Actions | null>;
  /** Runs on Esc after nested popups had their chance; return true to keep the modal open. */
  onEscape?: () => boolean;
  children: ReactNode;
}) {
  const closeAppModal = useCloseAppModal();
  // The modal mounts open and its entrance is a CSS `@starting-style` transition, so the frame
  // paints with the route. The page inside mounts a frame later (startTransition), with a skeleton
  // meanwhile, so its render cost lands during the entrance on the compositor, not before the
  // first frame.
  const [open, setOpen] = useState(true);
  const [pageReady, setPageReady] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a frame timer that mounts the page after the modal's first paint
  useEffect(() => {
    const frame = requestAnimationFrame(() => startTransition(() => setPageReady(true)));
    return () => cancelAnimationFrame(frame);
  }, []);
  // Text selection that ends on the backdrop is not a dismissal.
  const backdropPressRef = useRef(false);
  // Focus the surface, not its first control: no stray focus ring, no phone keyboard.
  // On close, return focus to the opener only after a keyboard close; after a pointer close it
  // would paint a focus ring.
  const popupRef = useRef<HTMLDivElement>(null);
  const [opener] = useState(
    () =>
      getCommandPaletteOpener() ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  );
  // Clear the native window controls (macOS traffic lights, the Windows and Linux caption
  // buttons). Below sm the modal fills the window and leaves that strip empty; up to lg its
  // 1.5rem inset is shorter than the strip.
  const nativeTitlebarHeight = useNativeTitlebarHeight();
  const router = useRouter();
  // Leaving the page without closing (Navigation: Back) unmounts a focused field during a
  // commit, when React no longer delivers its blur, so commit-on-blur rows would drop what was
  // typed. Blur text fields before the navigation renders; other controls keep their focus.
  // Not onBeforeNavigate: the router skips it while a past redirect is still recorded.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- router listener that blurs a field before navigation unmounts it
  useEffect(
    () =>
      router.subscribe("onBeforeLoad", ({ pathChanged }) => {
        const focused = document.activeElement;
        if (pathChanged && focused?.matches("input, textarea, [contenteditable]")) {
          blurFocusedWithin(popupRef.current);
        }
      }),
    [router],
  );

  return (
    <DialogPrimitive.Root
      open={open}
      actionsRef={actionsRef}
      // Portaled layers outside this tree (toasts, Clerk, confirm dialogs) are not backdrop presses.
      disablePointerDismissal
      onOpenChange={(nextOpen, eventDetails) => {
        if (nextOpen) return;
        // Base UI's dismiss handler fires on held Esc repeats after a nested popup closes.
        if (eventDetails.reason === "escape-key" && eventDetails.event.repeat) {
          return eventDetails.cancel();
        }
        // Esc from a layer outside Base UI (Clerk's modals) is that layer's to handle.
        const target = eventDetails.event.target;
        if (
          eventDetails.reason === "escape-key" &&
          target !== document.body &&
          target instanceof Node &&
          !popupRef.current?.contains(target)
        ) {
          return eventDetails.cancel();
        }
        if (eventDetails.reason === "escape-key" && onEscape?.()) return eventDetails.cancel();
        // Closing unmounts a focused field without a blur, so commit-on-blur rows would
        // drop what was typed. Blur first so they commit.
        blurFocusedWithin(popupRef.current);
        setOpen(false);
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) void closeAppModal();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogBackdrop />
        <DialogPrimitive.Viewport
          style={
            {
              "--app-modal-titlebar-height": `${nativeTitlebarHeight}px`,
              "--app-modal-top-inset": `max(env(safe-area-inset-top), ${nativeTitlebarHeight}px)`,
              "--app-modal-sm-top": `max(1.5rem, ${nativeTitlebarHeight}px)`,
            } as CSSProperties
          }
          // Electron hit-tests drag regions under the backdrop regardless of z-index; without
          // this, presses above the modal move the window instead of dismissing it.
          className="fixed inset-0 z-50 flex items-center justify-center [-webkit-app-region:no-drag] sm:p-6 sm:pt-(--app-modal-sm-top)"
          onPointerDown={(event) => {
            backdropPressRef.current = event.target === event.currentTarget;
          }}
          onClick={(event) => {
            if (backdropPressRef.current && event.target === event.currentTarget) setOpen(false);
            backdropPressRef.current = false;
          }}
        >
          <DialogPrimitive.Popup
            ref={popupRef}
            initialFocus={popupRef}
            finalFocus={(closeType) => {
              if (closeType !== "keyboard" || !opener?.isConnected) return false;
              if (!opener.closest("[inert]")) return opener;
              // The thread behind the modal stays inert until the route closes, so its area
              // takes focus once it is usable again.
              const area = opener.closest<HTMLElement>("[data-workspace-area]");
              if (area?.dataset.workspaceArea)
                requestWorkspaceFocus({ area: area.dataset.workspaceArea });
              return false;
            }}
            aria-label={label}
            data-slot="dialog-popup"
            data-app-modal=""
            data-one-reflect=""
            className="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background max-sm:pt-(--app-modal-top-inset) max-sm:pb-safe text-foreground outline-none [-webkit-app-region:no-drag] sm:max-h-[60rem] sm:max-w-[100rem] sm:rounded-(--m-radius-sheet)"
          >
            <span aria-hidden="true" className="one-reflection" />
            {/* The emptied strip still moves the window, as the titlebar it replaces does. */}
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 hidden h-(--app-modal-titlebar-height) [-webkit-app-region:drag] max-sm:block"
            />
            {pageReady ? (
              children
            ) : (
              // Under 250 ms the sheet is simply empty for a moment; an outline that flashes and
              // is replaced reads as scaffolding.
              <div className="app-route-modal-late flex min-h-0 flex-1">
                {skeleton ?? <AppRouteModalSkeleton />}
              </div>
            )}
            <GlobalVoiceInputIndicator />
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const SKELETON_NAV_ROWS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const SKELETON_CARDS = ["a", "b", "c"] as const;

/** The page's outline while it mounts: a nav column, a title and three cards. */
function AppRouteModalSkeleton() {
  return (
    <div aria-hidden className="flex min-h-0 flex-1">
      <div className="hidden w-64 shrink-0 flex-col gap-2 p-3 sm:flex">
        {SKELETON_NAV_ROWS.map((row) => (
          <Skeleton key={row} className="h-7 w-full" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-6 sm:px-16 sm:pt-20">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
        {SKELETON_CARDS.map((card) => (
          <Skeleton key={card} shape="card" className="h-32 w-full" />
        ))}
      </div>
    </div>
  );
}

function blurFocusedWithin(container: HTMLElement | null) {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && container?.contains(focused)) focused.blur();
}

export function AppRouteModalClose() {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <DialogPrimitive.Close
            aria-label={gt("Close")}
            render={<Button size="icon-sm" variant="ghost" />}
          />
        }
      >
        <XIcon />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <T>Close (Esc)</T>
      </TooltipPopup>
    </Tooltip>
  );
}
