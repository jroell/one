import { use, useEffect } from "react";

import { BackgroundThreadContext } from "./backgroundThread";
import { useOpenFavoriteEditorShortcut } from "./OpenInPickerShortcut";
import { useChatShortcuts, type ChatShortcutsInput } from "./useChatShortcuts";

/**
 * Shortcuts that stand down while the thread sits under Settings or Usage. They read that state
 * here so opening a modal page does not render the whole chat view.
 */
export function BackgroundGatedShortcuts(props: {
  readonly chatShortcuts: ChatShortcutsInput;
  readonly openFavoriteEditor: Parameters<typeof useOpenFavoriteEditorShortcut>[0];
  readonly embedded: boolean;
  readonly onMenuAction: (action: string) => void;
}) {
  const background = use(BackgroundThreadContext);
  const { onMenuAction, embedded } = props;
  useOpenFavoriteEditorShortcut({
    ...props.openFavoriteEditor,
    enabled: props.openFavoriteEditor.enabled && !background,
  });
  useChatShortcuts({ ...props.chatShortcuts, enabled: props.chatShortcuts.enabled && !background });
  // A focused desktop browser page forwards chords as menu actions.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to desktop bridge menu actions
  useEffect(() => {
    if (embedded || background) return;
    return window.desktopBridge?.onMenuAction(onMenuAction);
  }, [embedded, background, onMenuAction]);
  return null;
}
