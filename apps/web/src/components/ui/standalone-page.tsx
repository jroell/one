import type { ReactNode } from "react";

import { OneGlyph } from "../../one/OneGlyph";

export function StandalonePage({ children }: { readonly children: ReactNode }) {
  return (
    // The page owns scrolling because root cannot scroll; safe centering keeps oversized cards top-aligned.
    <div
      data-one-standalone-page=""
      className="flex h-full items-center-safe justify-center overflow-y-auto scrollbar-gutter-both bg-background px-4 py-10 text-foreground sm:px-6"
    >
      <section data-one-standalone="" className="dialog-glass w-full max-w-xl border p-6">
        {children}
      </section>
    </div>
  );
}

export function StandalonePageHeader({
  context,
  title,
  description,
}: {
  readonly context?: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
}) {
  return (
    <>
      <div
        data-one-standalone-brand=""
        className="flex items-center justify-between gap-3 text-muted-foreground"
      >
        <span className="flex items-center gap-2" role="img" aria-label="One">
          <OneGlyph size={20} />
          <span data-one-wordmark="" className="text-foreground">
            One
          </span>
        </span>
        {context ? (
          <span data-one-standalone-context="" className="text-xs">
            {context}
          </span>
        ) : null}
      </div>
      <h1 data-one-standalone-title="" className="mt-6 text-xl leading-tight font-semibold">
        {title}
      </h1>
      <p data-one-standalone-lead="" className="mt-2 text-sm text-muted-foreground">
        {description}
      </p>
    </>
  );
}
