/**
 * Every development-only visual fixture, by name. The pixel harness
 * (tests/visual/fixtures.spec.ts) renders each of these at every supported
 * size in both themes; `fixtures.tsx` maps each name to its component, and
 * the type there makes a missing one a compile error.
 */
export const VISUAL_FIXTURE_NAMES = [
  // S2 access: every state before a person is signed in.
  "splash",
  "splash-slow",
  "setup",
  "setup-problem",
  "pairing",
  "pairing-waiting",
  "pairing-declined",
  "locked-roster",
  "locked-roster-search",
  "locked-pin",
  "locked-pin-wrong",
  "locked-pin-paused",
  "locked-manual",
  "locked-offline",
  "locked-session-ended",
  "access-banners",
  "idle-lock",
  // S3 shift and cash.
  "no-shift",
  "open-shift-manager",
  "open-shift-no-permission",
  "day-close-blocked",
  "day-closed",
  "note-counter",
  "cash",
  "cash-cashier",
  "cash-no-permission",
  "cash-in",
  "cash-out",
  "close-count",
  "close-balanced",
  "close-over",
  // The register, redesigned in S4.
  "terminal",
  // S1 design foundation.
  "system",
  "shell",
  "shell-offline",
  "shell-kds",
  "approval-sheet",
  "command-search",
] as const;

export type VisualFixtureName = (typeof VISUAL_FIXTURE_NAMES)[number];

export function isVisualFixtureName(name: string): name is VisualFixtureName {
  return (VISUAL_FIXTURE_NAMES as readonly string[]).includes(name);
}
