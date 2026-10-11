import { mkdirSync, rmSync } from "node:fs";
import { RESULTS_DIR, SCREENS_DIR } from "./harness";

/** Each run starts with no findings or screenshots from an earlier run. */
export default function globalSetup(): void {
  rmSync(RESULTS_DIR, { recursive: true, force: true });
  rmSync(SCREENS_DIR, { recursive: true, force: true });
  mkdirSync(RESULTS_DIR, { recursive: true });
  mkdirSync(SCREENS_DIR, { recursive: true });
}
