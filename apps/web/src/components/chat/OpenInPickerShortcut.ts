import {
  buildRemoteOpenUrl,
  type EditorId,
  type EnvironmentId,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { msg } from "gt-react";
import { useEffect, useEffectEvent } from "react";

import { usePreferredEditor } from "../../editorPreferences";
import { editorLabelForPlatform } from "../../editorLabels";
import { isOpenFavoriteEditorShortcut } from "../../keybindings";
import { m } from "../../i18n/messages";
import { announce } from "../../lib/announce";
import { openRemoteEditorUrl, useRemoteCapableEditors, useRemoteOpenState } from "../../remoteOpen";
import { registerCommandHandlers } from "../../shortcuts/commandRegistry";
import { registerCommands } from "../../shortcuts/dispatcher";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";

/** Marks an OpenInPicker's primary button as the target of `editor.openFavorite`. */
export const OPEN_FAVORITE_EDITOR_ATTRIBUTE = "data-open-favorite-editor";

// The newest marked button that is on screen and enabled; one kept mounted out of sight is skipped.
const favoriteEditorButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>(`[${OPEN_FAVORITE_EDITOR_ATTRIBUTE}]`)]
    .reverse()
    .find((button) => !button.disabled && button.getClientRects().length > 0);

const canPressFavoriteEditorButton = () => favoriteEditorButton() !== undefined;

const pressFavoriteEditorButton = () => favoriteEditorButton()?.click();

/**
 * `editor.openFavorite` presses the marked OpenInPicker primary button, so the shortcut opens
 * exactly what the button on screen would, such as the file being viewed. Only with no usable
 * button does the chord reach the project fallback below, for a key and a palette row alike.
 * Capture phase, so a focused terminal does not swallow the chord.
 */
export function registerOpenFavoriteEditorCommand(): () => void {
  const disposeKey = registerCommands(
    {
      "editor.openFavorite": (event) => {
        if (event.repeat || !canPressFavoriteEditorButton()) return false;
        event.preventDefault();
        pressFavoriteEditorButton();
      },
    },
    { capture: true },
  );
  const disposeRow = registerCommandHandlers({
    "editor.openFavorite": { run: pressFavoriteEditorButton, canRun: canPressFavoriteEditorButton },
  });
  return () => {
    disposeKey();
    disposeRow();
  };
}

export function useOpenFavoriteEditorShortcut({
  enabled,
  environmentId,
  keybindings,
  availableEditors,
  openInCwd,
}: {
  enabled: boolean;
  environmentId: EnvironmentId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
}) {
  const openInEditorMutation = useAtomCommand(shellEnvironment.openInEditor, "open in editor");
  const remote = useRemoteOpenState(environmentId);
  const remoteCapableEditors = useRemoteCapableEditors();
  // Matches the picker: remote editors run on the viewing machine.
  const [preferredEditor] = usePreferredEditor(
    remote.mode === "local-exec" ? availableEditors : remoteCapableEditors,
  );

  const target =
    enabled && remote.mode !== "remote-unavailable" && openInCwd && preferredEditor
      ? { cwd: openInCwd, editor: preferredEditor }
      : null;
  const openFavorite = useEffectEvent(() => {
    if (!target) return false;
    const label = editorLabelForPlatform(target.editor, navigator.platform);
    if (remote.mode === "remote-links") {
      const url = buildRemoteOpenUrl({
        editor: target.editor,
        ...remote.host,
        absolutePath: target.cwd,
      });
      if (url === undefined) return false;
      void openRemoteEditorUrl(url).then((opened) => {
        if (opened) announce(m(msg("Opened in {editor}", { editor: label })));
      });
      return;
    }
    void openInEditorMutation({
      environmentId,
      input: target,
    }).then((result) => {
      if (result._tag === "Success") announce(m(msg("Opened in {editor}", { editor: label })));
    });
  });
  const canOpenFavorite = target !== null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes a window keydown listener for the open-in-editor shortcut and registers its command by id while enabled
  useEffect(() => {
    if (!enabled || remote.mode === "remote-unavailable") return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (
        event.repeat ||
        event.defaultPrevented ||
        !isOpenFavoriteEditorShortcut(event, keybindings)
      )
        return;
      if (!canOpenFavorite) return;

      event.preventDefault();
      openFavorite();
    };
    window.addEventListener("keydown", handler);
    // The newest registration is tried first, so the fallback steps aside while a button is usable.
    const disposeRow = registerCommandHandlers({
      "editor.openFavorite": {
        run: () => openFavorite(),
        canRun: () => canOpenFavorite && !canPressFavoriteEditorButton(),
      },
    });
    return () => {
      window.removeEventListener("keydown", handler);
      disposeRow();
    };
  }, [canOpenFavorite, enabled, keybindings, remote.mode]);
}
