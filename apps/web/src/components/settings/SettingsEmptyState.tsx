import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";

/**
 * The one empty or unavailable state in Settings: an icon tile, a serif headline, one sentence
 * that gives a concrete example, and at most one filled button. The look is in one-settings.css.
 */
export function SettingsEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
  /** One button. A second action belongs in the page, not here. */
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  return (
    <Empty data-settings-empty="" className={cn("min-h-64", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
