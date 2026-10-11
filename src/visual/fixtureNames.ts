/**
 * Every development-only visual fixture, by name. The pixel harness
 * (tests/visual/fixtures.spec.ts) renders each of these at every supported
 * size in both themes; `fixtures.tsx` maps each name to its component, and
 * the type there makes a missing one a compile error.
 */
export const VISUAL_FIXTURE_NAMES = [
  // Existing screens, redesigned in S2 (access) and S4 (register).
  "splash",
  "pairing",
  "pairing-waiting",
  "locked-roster",
  "locked-pin",
  "no-shift",
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
