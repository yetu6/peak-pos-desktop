/**
 * Plain words for the kitchen and bar display: a ticket's age, its next
 * step, the stations, and the backend's refusals when a ticket is moved
 * (fbc-peak internal/pos operations.go TransitionOrder, stations.go
 * TransitionStationTicket).
 */
import type { POSStationTicket, PrepStation } from "../lib/posContracts";
import { otherWords, problemOf, UNREACHABLE } from "../lib/problemWords";
import type { Tone } from "../lib/words";
import { KITCHEN_LATE_AFTER_MINUTES, KITCHEN_NEW_MARKER_SECONDS, KITCHEN_WARN_AFTER_MINUTES } from "./kitchenSettings";

type Step = POSStationTicket["status"];
export type NextStatus = "PREPARING" | "READY" | "SERVED";

export interface AgeThresholds {
  warnAfterMinutes: number;
  lateAfterMinutes: number;
}

const DEFAULT_THRESHOLDS: AgeThresholds = {
  warnAfterMinutes: KITCHEN_WARN_AFTER_MINUTES,
  lateAfterMinutes: KITCHEN_LATE_AFTER_MINUTES,
};

export interface TicketAge {
  words: string;
  tone: Tone;
  /** Whole minutes since it was sent; null when Yetu gave no time. */
  minutes: number | null;
}

function elapsedMs(sentAt: string | undefined, nowMs: number): number | null {
  if (!sentAt) return null;
  const sent = Date.parse(sentAt);
  if (!Number.isFinite(sent)) return null;
  // A till whose clock is behind Yetu's sees a ticket sent "in the future": none yet.
  return Math.max(0, nowMs - sent);
}

/** "On time · 4 min", "Getting late · 12 min", "Late · 18 min", from the time Yetu says it was sent. */
export function ticketAge(sentAt: string | undefined, nowMs: number, thresholds: AgeThresholds = DEFAULT_THRESHOLDS): TicketAge {
  const elapsed = elapsedMs(sentAt, nowMs);
  if (elapsed === null) return { words: "Sent time not known", tone: "neutral", minutes: null };
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes >= thresholds.lateAfterMinutes) return { words: `Late · ${minutes} min`, tone: "danger", minutes };
  if (minutes >= thresholds.warnAfterMinutes) return { words: `Getting late · ${minutes} min`, tone: "warning", minutes };
  return { words: `On time · ${minutes} min`, tone: "neutral", minutes };
}

/** A ticket nobody has started, sent within the last KITCHEN_NEW_MARKER_SECONDS. */
export function isNewTicket(status: Step, sentAt: string | undefined, nowMs: number): boolean {
  if (status !== "SENT") return false;
  const elapsed = elapsedMs(sentAt, nowMs);
  return elapsed !== null && elapsed < KITCHEN_NEW_MARKER_SECONDS * 1000;
}

const NEXT_STEP: Partial<Record<Step, { target: NextStatus; words: string; pendingWords: string }>> = {
  SENT: { target: "PREPARING", words: "Start", pendingWords: "Starting…" },
  PREPARING: { target: "READY", words: "Ready", pendingWords: "Marking ready…" },
  READY: { target: "SERVED", words: "Served", pendingWords: "Marking served…" },
};

/** The one step a ticket can take next (Yetu's own order of steps); null once it is served. */
export function nextStepFor(status: Step): { target: NextStatus; words: string; pendingWords: string } | null {
  return Object.prototype.hasOwnProperty.call(NEXT_STEP, status) ? (NEXT_STEP[status] ?? null) : null;
}

const STATION: Record<PrepStation, string> = {
  GENERAL: "Kitchen",
  HOT: "Hot kitchen",
  COLD: "Cold kitchen",
  BAR: "Bar",
  GRILL: "Grill",
  PASTRY: "Pastry",
};

export function stationWords(station: string): string {
  return Object.prototype.hasOwnProperty.call(STATION, station) ? STATION[station as PrepStation] : "Other station";
}

const DONE: Record<NextStatus, string> = {
  PREPARING: "started",
  READY: "is ready",
  SERVED: "is served",
};

/** What a step did, said back to the person: "Order 0142 is ready." */
export function stepDoneWords(target: NextStatus, orderNumber: string, station?: string): string {
  const which = station ? `Order ${orderNumber} (${stationWords(station)})` : `Order ${orderNumber}`;
  return `${which} ${DONE[target]}.`;
}

export interface KitchenProblem {
  kind: "stale" | "permission" | "network" | "other";
  words: string;
}

/** Moving a ticket on a step (TransitionOrder / TransitionStationTicket). */
export function kitchenProblem(error: unknown): KitchenProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  // Another screen moved it first: the version or the step no longer matches.
  if (problem.code === "STALE_VERSION") {
    return { kind: "stale", words: "Someone moved this ticket on another screen. The board shows the latest now." };
  }
  // The role lacks pos.order.send, or the ticket belongs to a station this screen isn't set to show.
  if (problem.code === "FORBIDDEN") {
    return {
      kind: "permission",
      words: "This ticket can't be moved from here. Your role or this screen's kitchen stations don't allow it. Ask a manager.",
    };
  }
  return { kind: "other", words: otherWords(problem, "The ticket didn't move. Try again.") };
}
