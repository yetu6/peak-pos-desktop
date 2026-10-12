import type { DevicePhase } from "../auth/DeviceSessionProvider";

/**
 * The terminal's routed state, named from the terminal's operating model.
 * `UNCONFIGURED` is the one state outside that vocabulary on purpose: it
 * is the installer/development-only path (no packaged or persisted server
 * address), never a normal operator state, and is named separately so it can
 * never be confused with `UNPROVISIONED` (a real, identified, unpaired
 * device).
 */
export type TerminalRoute =
  | "STARTING"
  | "UNCONFIGURED"
  | "UNPROVISIONED"
  | "PAIRING"
  | "LOCKED"
  | "NO_SHIFT"
  | "OPERATIONAL";

/**
 * Explicit terminal-state routing. Every `DevicePhase` value is matched by
 * name — there is no catch-all `else` that silently absorbs an unhandled
 * phase into whatever screen happens to be last in a chain of `if`s. The
 * `shift`/`shiftKnown` pair models the shift lifecycle:
 * an authenticated staff member with no open shift gets a dedicated Open
 * Shift workspace, never the operational register in a half-disabled state.
 * A device that takes no cash (a kitchen or bar display) needs no shift:
 * `shiftRequired: false` sends it straight to its work.
 */
export function terminalRoute(
  phase: DevicePhase,
  shiftKnown: boolean,
  hasOpenShift: boolean,
  { shiftRequired = true }: { shiftRequired?: boolean } = {},
): TerminalRoute {
  switch (phase) {
    case "bootstrapping":
      return "STARTING";
    case "needs-url":
      return "UNCONFIGURED";
    case "unpaired":
      return "UNPROVISIONED";
    case "waiting":
      return "PAIRING";
    case "locked":
      return "LOCKED";
    case "ready":
      return shiftRequired && shiftKnown && !hasOpenShift ? "NO_SHIFT" : "OPERATIONAL";
    default: {
      // Exhaustiveness guard: a new DevicePhase value fails the build here
      // instead of silently falling through to an arbitrary screen.
      const exhaustive: never = phase;
      throw new Error(`unrouted terminal phase: ${String(exhaustive)}`);
    }
  }
}
