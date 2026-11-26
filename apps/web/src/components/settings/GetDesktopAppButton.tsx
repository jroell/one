import { useGT } from "gt-react";

import { DESKTOP_DOWNLOAD_URL } from "../../branding";
import { Button } from "../ui/button";

/** The one way every "only in the desktop app" message offers the fix. */
export function GetDesktopAppButton({
  variant = "default",
  size = "default",
}: {
  readonly variant?: "default" | "outline";
  readonly size?: "default" | "sm" | "xs";
}) {
  const gt = useGT();
  return (
    <Button
      variant={variant}
      size={size}
      render={<a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer noopener" />}
    >
      {gt("Get the desktop app")}
    </Button>
  );
}
