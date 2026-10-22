import { PREP_STATIONS, stationWords } from "../kitchen/kitchenWords";
import type { POSOrder, PrepStation } from "../lib/posContracts";

/**
 * Rounds (fbc-peak S17a): an order takes more after it was sent -- dessert
 * after the mains, the next round of drinks -- and each send is the next
 * round. A Yetu from before rounds sends no `roundsSent`: there an order
 * takes nothing once sent, as before.
 */

type OrderState = Pick<POSOrder, "status" | "items" | "roundsSent">;

/** Whether the order takes another line now. */
export function takesMore(order: OrderState | null): boolean {
  if (!order) return true;
  if (order.status === "CLOSED" || order.status === "VOIDED") return false;
  return order.status === "OPEN" || order.roundsSent !== undefined;
}

/** Lines added and not yet sent to the kitchen. */
export function unsentLines(order: OrderState | null): number {
  return (order?.items ?? []).filter((line) => line.status === "ADDED").length;
}

/** No production paper only when every new line explicitly says Direct. */
export function directOnlyUnsent(order: OrderState | null): boolean {
  const lines = (order?.items ?? []).filter((line) => line.status === "ADDED");
  return lines.length > 0 && lines.every((line) => line.fulfilment === "DIRECT");
}

/**
 * The stations with something new to print, each once, in the till's order
 * of stations (owner, 2026-10-22: Print for bar, Print for kitchen). Null
 * when a new line doesn't say where it is made (a Yetu before stations on
 * lines): the till can't choose for it, and prints the whole order.
 */
export function unsentStations(order: OrderState | null): PrepStation[] | null {
  const unsent = (order?.items ?? []).filter((line) => line.status === "ADDED" && line.fulfilment !== "DIRECT");
  if (unsent.some((line) => !line.prepStation)) return null;
  return PREP_STATIONS.filter((station) => unsent.some((line) => line.prepStation === station));
}

/** A station as said inside a sentence: "bar", "hot kitchen". */
function stationInWords(station: string): string {
  const name = stationWords(station);
  return `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

/** One station's print button: "Print for bar", "Print for kitchen". */
export function stationPrintWords(station: string): string {
  return `Print for ${stationInWords(station)}`;
}

/** One station's button when it prints nothing on this till and reads its screen: "Send to bar". */
export function stationSendWords(station: string): string {
  return `Send to ${stationInWords(station)}`;
}

/**
 * What the ticket's print button says: the station it prints for when only
 * one has something new, the order when several do, again when nothing is new.
 */
export function printWords(order: OrderState | null): string {
  if (order && unsentLines(order) === 0 && (order.roundsSent ?? 0) > 0) return "Print again";
  if (directOnlyUnsent(order)) return "Send order";
  const stations = unsentStations(order);
  return stations?.length === 1 ? stationPrintWords(stations[0]) : "Print order";
}

/** What the send button says: the first send, then each round by its number. */
export function sendWords(order: OrderState | null): string {
  const sent = order?.roundsSent ?? 0;
  return sent > 0 ? `Send round ${sent + 1}` : "Send to kitchen";
}

/** Why the order can't be paid just now, as Yetu says it (UNSENT_LINES); null when it can. */
export function payWaitsWords(order: OrderState | null): string | null {
  if (!order || (order.roundsSent ?? 0) === 0 || unsentLines(order) === 0) return null;
  return "Print the new items first, or remove them, then take payment.";
}

/** A sent line's round, said on the ticket once there is more than one. */
export function roundWords(round: number | undefined, roundsSent: number | undefined): string | undefined {
  if (!round || (roundsSent ?? 0) < 2) return undefined;
  return `Round ${round}`;
}

/** A group of an order's lines on the ticket: one round sent, or the lines not sent yet. */
export interface LineGroup<L> {
  key: string;
  /** "Round 1", "Not sent yet"; null when the ticket needs no headings. */
  title: string | null;
  lines: L[];
}

/**
 * The ticket's lines by round (the leaders keep what went to the kitchen
 * apart from what didn't): each round sent, oldest first, then what isn't
 * sent yet, last, where the next tap adds. Headings only when there is
 * something to tell apart -- more than one round, or lines sent and lines
 * not; otherwise one group with none. A line sent before rounds was the first.
 */
export function linesByRound<L extends { status: string; roundNumber?: number }>(lines: readonly L[]): LineGroup<L>[] {
  const live = lines.filter((line) => line.status !== "VOIDED");
  const unsent = live.filter((line) => line.status === "ADDED");
  const sent = live.filter((line) => line.status !== "ADDED");
  const rounds = new Map<number, L[]>();
  for (const line of sent) {
    const round = line.roundNumber ?? 1;
    rounds.set(round, [...(rounds.get(round) ?? []), line]);
  }
  const headed = rounds.size > 1 || (rounds.size > 0 && unsent.length > 0);
  if (!headed) return live.length ? [{ key: "all", title: null, lines: live }] : [];
  const groups: LineGroup<L>[] = [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, roundLines]) => ({ key: `round-${round}`, title: `Round ${round}`, lines: roundLines }));
  if (unsent.length) groups.push({ key: "unsent", title: "Not sent yet", lines: unsent });
  return groups;
}
