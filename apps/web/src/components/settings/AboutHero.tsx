import { T, useLocale } from "gt-react";

import { APP_BASE_NAME, APP_BUILD_DATE, APP_STAGE_LABEL, APP_VERSION } from "../../branding";
import { OneMark } from "../../one/OneMark";
import { SettingsSearchTarget } from "./settingsLayout";

/** A stored YYYY-MM-DD day in the given locale's date style, or null when missing or not a real day. */
export function formatBuildDay(day: string | null, locale?: string): string | null {
  if (day === null || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  // An impossible day such as 02-30 parses but rolls into the next month.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

/** The brand moment at the top of About: the mark, the name in the opening's serif, the version. */
export function AboutHero({ id }: { readonly id?: string }) {
  const locale = useLocale();
  const buildDay = formatBuildDay(APP_BUILD_DATE, locale);
  return (
    <SettingsSearchTarget
      {...(id === undefined ? {} : { id })}
      data-settings-about-hero=""
      className="flex items-center gap-5 px-3 sm:px-4"
    >
      {/* The same lit mark as the boot screen, with no glow disc behind it. */}
      <OneMark className="size-16 shrink-0" size={64} style={{ filter: "none" }} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p data-settings-about-name="">{APP_BASE_NAME}</p>
        <p data-settings-about-version="">
          <T>Version</T> <span>{APP_VERSION}</span>
          {APP_STAGE_LABEL ? <span> · {APP_STAGE_LABEL}</span> : null}
        </p>
        {buildDay === null ? null : (
          <p data-settings-about-build="">
            <T>Built</T> <time dateTime={APP_BUILD_DATE ?? undefined}>{buildDay}</time>
          </p>
        )}
      </div>
    </SettingsSearchTarget>
  );
}
