import type { POSOrder } from "../lib/posContracts";

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

/** What the send button says: the first send, then each round by its number. */
export function sendWords(order: OrderState | null): string {
  const sent = order?.roundsSent ?? 0;
  return sent > 0 ? `Send round ${sent + 1}` : "Send to kitchen";
}

/** Why the order can't be paid just now, as Yetu says it (UNSENT_LINES); null when it can. */
export function payWaitsWords(order: OrderState | null): string | null {
  if (!order || (order.roundsSent ?? 0) === 0 || unsentLines(order) === 0) return null;
  return "Send or remove what isn't sent yet, then take payment.";
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
