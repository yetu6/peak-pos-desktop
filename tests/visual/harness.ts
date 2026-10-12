import { join } from "node:path";
import type { VisualFixtureName } from "../../src/visual/fixtureNames";

/** Where screenshots, findings and the HTML report go (gitignored). */
export const OUTPUT_DIR = join(import.meta.dirname, "..", "..", "visual-output");
export const RESULTS_DIR = join(OUTPUT_DIR, "results");
export const SCREENS_DIR = join(OUTPUT_DIR, "screens");

/** A port of its own, so the harness never reuses a dev server running older code. */
export const HARNESS_PORT = 5181;

export const VIEWPORTS = [
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
] as const;

export const THEMES = ["light", "dark"] as const;

/** The smallest operational text, the technical-detail exception, and the smallest target. */
export const MIN_TEXT_PX = 14;
export const MIN_TECHNICAL_TEXT_PX = 13;
export const MIN_TARGET_PX = 48;

export interface Finding {
  /** `overflow`, `must-fit`, `focus-ring`, `text-size`, `target-size` or `axe:<rule>`. */
  key: string;
  detail: string;
}

export interface FixtureResult {
  fixture: VisualFixtureName;
  viewport: string;
  theme: (typeof THEMES)[number];
  findings: Finding[];
}

/**
 * Findings the existing screens still carry, by fixture, each owned by the
 * slice that redesigns that screen. Only these may fail, and only on these
 * fixtures. The known-debt check fails when a listed finding no longer occurs
 * anywhere, so the list can only shrink: delete the line when a slice fixes it.
 */
export const KNOWN_DEBT: Partial<Record<VisualFixtureName, { owner: string; keys: string[] }>> = {
  "no-shift": { owner: "S3 shift and cash", keys: ["text-size", "target-size"] },
  terminal: { owner: "S4 register", keys: ["text-size"] },
};
