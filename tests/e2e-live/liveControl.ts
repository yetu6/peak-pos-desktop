/**
 * Stopping and starting the live API mid-journey, and reading what it
 * recorded, for the S6 suite (a payment whose answer was lost, Yetu down and
 * back). The API is found by the port it listens on and stopped by its pid;
 * it is started again from the binary live-api.sh already built.
 */
import { execFileSync, spawn } from "node:child_process";
import { openSync } from "node:fs";
import { join } from "node:path";
import { LIVE_API_URL } from "./liveSettings";

const script = join(import.meta.dirname, "live-api.sh");
const work = process.env.E2E_WORK_DIR ?? join(import.meta.dirname, ".work");
const port = new URL(LIVE_API_URL).port;

async function healthy(): Promise<boolean> {
  try {
    return (await fetch(`${LIVE_API_URL}/health/live`, { signal: AbortSignal.timeout(1_000) })).ok;
  } catch {
    return false;
  }
}

async function until(check: () => Promise<boolean>, what: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** The pid listening on the live API's port. */
function apiPid(): number | null {
  const listening = execFileSync("ss", ["-ltnpH", `sport = :${port}`], { encoding: "utf-8" });
  const match = /pid=(\d+)/.exec(listening);
  return match ? Number(match[1]) : null;
}

/** Stop the live API (SIGTERM to the process on its port) and wait until it no longer answers. */
export async function stopLiveApi(): Promise<void> {
  const pid = apiPid();
  if (pid === null) throw new Error(`nothing listens on :${port}`);
  process.kill(pid, "SIGTERM");
  await until(async () => !(await healthy()) && apiPid() === null, "the live API to stop", 30_000);
}

/** Start the live API again from its built binary and wait until it answers. */
export async function startLiveApi(): Promise<void> {
  const log = openSync(join(work, "api.log"), "a");
  spawn("bash", [script, "api"], {
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, E2E_SKIP_BUILD: "1" },
  }).unref();
  await until(healthy, "the live API to answer again", 90_000);
}

/** How many pos_payments rows the order has, counted in the database (read-only). */
export function paymentRows(orderId: string): number {
  return Number(execFileSync("bash", [script, "payments", orderId], { encoding: "utf-8" }).trim());
}
