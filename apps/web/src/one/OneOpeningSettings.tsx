import { useGT } from "gt-react";

import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { useSearchableSetting } from "~/components/settings/settingsSearch";
import { replayOpening, setOpeningPreferences, useOpeningPreferences } from "./openingPreferences";
import { unlockOpeningSound } from "./openingSound";

/** Settings rows for the opening: play it, mute it, watch it again. */
export function OneOpeningSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const preferences = useOpeningPreferences();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // The sound starts later, in the opening's own effect, when the click that asked for it is
  // over; the browser may only allow audio during that click, so it is unlocked here.
  const playNow = () => {
    if (preferences.sound) unlockOpeningSound();
    replayOpening();
  };
  return (
    <>
      <SettingsRow
        {...searchableSetting("setting-opening-animation")}
        devicePreference
        description={
          reducedMotion
            ? gt("Off while your system asks for reduced motion.")
            : gt(
                "The ring ignites when One opens. Any key or click skips it, and it never plays under reduced motion.",
              )
        }
        control={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="xs" disabled={reducedMotion} onClick={playNow}>
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
            onCheckedChange={(checked) => setOpeningPreferences({ sound: Boolean(checked) })}
            aria-label={gt("Opening sound")}
          />
        }
      />
    </>
  );
}
