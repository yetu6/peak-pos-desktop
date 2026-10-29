import { NO_PAPER, type PrinterChoice, type PrinterSettings } from "./printerSettings";

/** What the till app reports for one system printer (src-tauri printer_health.rs). */
export interface PrinterHealth {
  state: "ready" | "offline" | "paper-out" | "problem" | "unknown";
  /** What the system called a problem, such as "PaperJam". */
  detail: string | null;
  /** Papers waiting in the system's queue longer than they should. */
  stuckJobs: number;
}

const PROBLEM_WORDS: Record<string, string> = {
  paperjam: "Paper jam",
  paperproblem: "Paper problem",
  dooropen: "Cover open",
  paused: "Paused in Windows",
  nottoner: "Out of ink or toner",
  notoner: "Out of ink or toner",
  outputbinfull: "Output tray full",
};

/** A printer's state in the till's words. Unknown is "Windows can't tell", never a false "Ready". */
export function printerHealthWords(health: PrinterHealth): { ok: boolean; words: string } {
  // Waiting papers print once the printer is put right (paper in, lid shut, power on), so the
  // till never says to cancel them: that would throw away an order the kitchen still needs.
  const stuck =
    health.stuckJobs > 0
      ? `${health.stuckJobs} ${health.stuckJobs === 1 ? "paper" : "papers"} waiting to print`
      : null;
  let state: string | null;
  switch (health.state) {
    case "ready":
      state = null;
      break;
    case "offline":
      state = "Switched off or not connected";
      break;
    case "paper-out":
      state = "Out of paper";
      break;
    case "problem":
      state = PROBLEM_WORDS[(health.detail ?? "").toLowerCase()] ?? "Needs attention in Windows";
      break;
    default:
      state = "Windows can't tell";
  }
  if (state === null && stuck === null) return { ok: true, words: "Ready" };
  return { ok: false, words: [state, stuck].filter(Boolean).join(". ") };
}

/** Every system printer this till prints to, once each: bills, kitchen and stations. */
export function systemPrinterNames(settings: PrinterSettings): string[] {
  const choices: Array<PrinterChoice | typeof NO_PAPER | null | undefined> = [settings.receipt, settings.kitchen, ...Object.values(settings.stations)];
  const names = new Set<string>();
  for (const choice of choices) {
    if (choice && choice !== NO_PAPER && choice.target.kind === "system") names.add(choice.target.name);
  }
  return [...names];
}

export async function loadPrinterHealth(name: string): Promise<PrinterHealth> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<PrinterHealth>("printer_health", { name });
  } catch {
    return { state: "unknown", detail: null, stuckJobs: 0 };
  }
}
