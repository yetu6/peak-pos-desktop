import type { DevicePhase } from "../auth/DeviceSessionProvider";

/**
 * The terminal's routed state, named from PEAK_TERMINAL_MASTER_OPERATIONS.md
 * §9. `UNCONFIGURED` is the one state outside that vocabulary on purpose: it
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
 * `shift`/`shiftKnown` pair models PEAK_TERMINAL_MASTER_OPERATIONS.md §11.1:
 * an authenticated staff member with no open shift gets a dedicated Open
 * Shift workspace, never the operational register in a half-disabled state.
 */
export function terminalRoute(
  phase: DevicePhase,
  shiftKnown: boolean,
  hasOpenShift: boolean,
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
      return shiftKnown && !hasOpenShift ? "NO_SHIFT" : "OPERATIONAL";
    default: {
      // Exhaustiveness guard: a new DevicePhase value fails the build here
      // instead of silently falling through to an arbitrary screen.
      const exhaustive: never = phase;
      throw new Error(`unrouted terminal phase: ${String(exhaustive)}`);
    }
  }
}
