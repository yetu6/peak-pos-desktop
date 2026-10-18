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
