import { useGT } from "gt-react";

import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { useSearchableSetting } from "~/components/settings/settingsSearch";
import { replayOpening, setOpeningPreferences, useOpeningPreferences } from "./openingPreferences";

/** Settings rows for the opening: play it, mute it, watch it again. */
export function OneOpeningSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const preferences = useOpeningPreferences();
  return (
    <>
      <SettingsRow
        {...searchableSetting("setting-opening-animation")}
        devicePreference
        description={gt(
          "The ring ignites when One opens. Any key or click skips it, and it never plays under reduced motion.",
        )}
        control={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="xs" onClick={replayOpening}>
              {gt("Play it now")}
            </Button>
            <Switch
              checked={preferences.animation}
              onCheckedChange={(checked) => setOpeningPreferences({ animation: Boolean(checked) })}
              aria-label={gt("Opening animation")}
            />
          </div>
        }
      />
      <SettingsRow
        {...searchableSetting("setting-opening-sound")}
        devicePreference
        description={gt("A quiet swell and one soft tone as the ring ignites.")}
        control={
          <Switch
            checked={preferences.sound}
            disabled={!preferences.animation}
            onCheckedChange={(checked) => setOpeningPreferences({ sound: Boolean(checked) })}
            aria-label={gt("Opening sound")}
          />
        }
      />
    </>
  );
}
