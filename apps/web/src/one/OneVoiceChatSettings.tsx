import { useGT } from "gt-react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { useSearchableSetting } from "~/components/settings/settingsSearch";
import { Switch } from "~/components/ui/switch";
import { setVoiceChatStyle, useVoiceChatStyle } from "./voiceChatPreferences";

/** Settings for how voice chat reads replies aloud. */
export function OneVoiceChatSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const style = useVoiceChatStyle();
  return (
    <SettingsSection id="voice-chat" title={gt("Voice chat")}>
      <SettingsRow
        {...searchableSetting("setting-voice-chat-conqueror")}
        devicePreference
        description={gt(
          "Voice chat reads replies in the deepest voice this device has, lowered and slowed. Off uses the normal system voice.",
        )}
        control={
          <Switch
            checked={style === "conqueror"}
            onCheckedChange={(checked) => setVoiceChatStyle(checked ? "conqueror" : "natural")}
            aria-label={gt("Conqueror voice")}
          />
        }
      />
    </SettingsSection>
  );
}
