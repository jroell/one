import { T } from "gt-react";

import { APP_BASE_NAME, APP_BUILD_DATE, APP_STAGE_LABEL, APP_VERSION } from "../../branding";
import { OneMark } from "../../one/OneMark";
import { SettingsSearchTarget } from "./settingsLayout";

/** The brand moment at the top of About: the mark, the name in the opening's serif, the version. */
/** A stored YYYY-MM-DD day in the reader's own date style, or null when it is missing or malformed. */
export function formatBuildDay(day: string | null, locale?: string): string | null {
  if (day === null || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

export function AboutHero({ id }: { readonly id?: string }) {
  const buildDay = formatBuildDay(APP_BUILD_DATE);
  return (
    <SettingsSearchTarget
      {...(id === undefined ? {} : { id })}
      data-settings-about-hero=""
      className="flex items-center gap-5 px-3 sm:px-4"
    >
      <OneMark className="size-16 shrink-0" />
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
