import { useGT } from "gt-react";
import { AudioLinesIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useVoiceBridge } from "./voiceBridge";
import { startVoiceChat } from "./startVoiceChat";
import { useWorkspaceMode } from "./workspaceMode";

/** Opens voice chat from the header. Shown in chat mode when the composer can take dictation. */
export function VoiceChatButton() {
  const gt = useGT();
  const mode = useWorkspaceMode();
  const voice = useVoiceBridge();
  if (mode !== "chat" || !voice?.available) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0" />}>
        <Button
          variant="ghost"
          size="icon-sm-pill"
          aria-label={gt("Start voice chat")}
          className="pointer-events-auto [-webkit-app-region:no-drag]"
          onClick={() => startVoiceChat(voice)}
        >
          <AudioLinesIcon />
        </Button>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{gt("Start voice chat")}</TooltipPopup>
    </Tooltip>
  );
}
