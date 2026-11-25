import { msg, useGT, useMessages } from "gt-react";

import { InlineButton } from "../ui/button";

import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { SETTINGS_DETAIL_PAGE_PARENTS } from "./settingsDetailPages";
import { SETTINGS_SECTION_LABELS } from "./settingsSearch";
import { useSettingsBreadcrumbTail } from "./settingsBreadcrumbTail";
import { trimTrailingSlashes } from "./useSettingsPathname";

const SETTINGS_LABEL = msg("Settings");

const SETTINGS_BREADCRUMB_LABELS: Readonly<Record<string, string>> = {
  ...SETTINGS_SECTION_LABELS,
  "/settings/diagnostics": msg("Diagnostics"),
  "/settings/open-source-licenses": msg("Open source licenses"),
};

function settingsBreadcrumbLabel(pathname: string): string | null {
  return SETTINGS_BREADCRUMB_LABELS[trimTrailingSlashes(pathname)] ?? null;
}

export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  const gt = useGT();
  const m = useMessages();
  const sectionLabel = settingsBreadcrumbLabel(pathname);
  const parentPath = SETTINGS_DETAIL_PAGE_PARENTS[trimTrailingSlashes(pathname)];
  // A page opened inside this section (one provider) adds its name after the section's.
  const tail = useSettingsBreadcrumbTail();

  return (
    <WorkspaceBreadcrumb ariaLabel={gt("Settings breadcrumb")}>
      {sectionLabel ? (
        <>
          <WorkspaceBreadcrumbItem>{m(SETTINGS_LABEL)}</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
          {parentPath ? (
            <>
              <WorkspaceBreadcrumbItem>
                {m(SETTINGS_SECTION_LABELS[parentPath])}
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator />
            </>
          ) : null}
        </>
      ) : null}
      <WorkspaceBreadcrumbItem current={tail === null} className="truncate">
        {tail === null ? (
          m(sectionLabel ?? SETTINGS_LABEL)
        ) : (
          <InlineButton tone="muted" onClick={tail.onUp}>
            {m(sectionLabel ?? SETTINGS_LABEL)}
          </InlineButton>
        )}
      </WorkspaceBreadcrumbItem>
      {tail === null ? null : (
        <>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current className="truncate">
            {tail.label}
          </WorkspaceBreadcrumbItem>
        </>
      )}
    </WorkspaceBreadcrumb>
  );
}
