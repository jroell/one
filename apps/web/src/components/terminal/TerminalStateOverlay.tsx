import type { TerminalSessionState } from "@t3tools/client-runtime/state/terminal";
import { T, useGT, Var } from "gt-react";
import { CircleAlertIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { Atom } from "effect/reactivity";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { appAtomRegistry } from "~/rpc/atomRegistry";

type TerminalPhase = "starting" | "ready" | "error";

/** What the pane should say, from the session's own flags. Output chunks never change it. */
export function terminalPhase(
  session: Pick<TerminalSessionState, "status" | "error" | "version">,
): TerminalPhase {
  if (session.status === "error" || session.error !== null) return "error";
  return session.version > 0 && session.status !== "starting" ? "ready" : "starting";
}

function useTerminalSessionValue<T extends string | null>(
  atom: Atom.Atom<TerminalSessionState>,
  select: (session: TerminalSessionState) => T,
): T {
  return useSyncExternalStore(
    (listener) => appAtomRegistry.subscribe(atom, listener),
    () => select(appAtomRegistry.get(atom)),
    () => select(appAtomRegistry.get(atom)),
  );
}

/** Home-relative cwd for display; the full path stays in the tooltip. */
export function displayTerminalCwd(cwd: string): string {
  const parts = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : cwd;
}

export function TerminalStateOverlay(props: {
  readonly atom: Atom.Atom<TerminalSessionState>;
  readonly cwd: string;
  readonly onRetry: () => void;
}) {
  const gt = useGT();
  const phase = useTerminalSessionValue(props.atom, (session) => terminalPhase(session));
  const error = useTerminalSessionValue(props.atom, (session) => session.error);
  return (
    <div
      data-one-terminal-state={phase}
      role={phase === "error" ? "alert" : "status"}
      aria-hidden={phase === "ready" ? true : undefined}
    >
      {phase === "starting" ? (
        <p className="flex min-w-0 items-center gap-2" data-one-terminal-starting="">
          <Spinner size="sm" tone="muted" />
          <span className="min-w-0 truncate">
            <T>
              Starting shell in <Var>{displayTerminalCwd(props.cwd)}</Var>…
            </T>
          </span>
        </p>
      ) : null}
      {phase === "error" ? (
        <div
          className="flex min-w-0 max-w-md flex-col items-start gap-2"
          data-one-terminal-error=""
        >
          <p className="flex items-center gap-2 font-medium text-destructive">
            <CircleAlertIcon aria-hidden className="size-4 shrink-0" />
            <T>Couldn&apos;t start the shell.</T>
          </p>
          {error ? (
            <p className="break-words font-mono text-2xs text-muted-foreground">{error}</p>
          ) : null}
          <Button size="xs" variant="outline" onClick={props.onRetry}>
            {gt("Retry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
