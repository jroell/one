import { T } from "gt-react";

import { APP_BASE_NAME, APP_STAGE_LABEL, APP_VERSION } from "../../branding";
import { OneMark } from "../../one/OneMark";

/** The brand moment at the top of About: the mark, the name in the opening's serif, the version. */
export function AboutHero() {
  return (
    <div data-settings-about-hero="" className="flex items-center gap-5 px-3 sm:px-4">
      <OneMark className="size-16 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p data-settings-about-name="">{APP_BASE_NAME}</p>
        <p data-settings-about-version="">
          <T>Version</T> <span>{APP_VERSION}</span>
          {APP_STAGE_LABEL ? <span> · {APP_STAGE_LABEL}</span> : null}
        </p>
      </div>
    </div>
  );
}
