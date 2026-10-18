/**
 * Plain words for refunds by item (S7, fbc-peak internal/pos/refunds.go).
 *
 * Yetu writes each refund refusal's detail for the person at the till
 * (`RefundRefusal`: "Open a shift on this till before giving a refund.",
 * "Only 1 of Chips can still be refunded."), so for the refund codes the till
 * shows it, with words of its own when there is none. VALIDATION_FAILED is
 * shared with the contract check, whose detail is schema text, so it always
 * gets the till's words.
 */
import { formatMoney } from "../lib/money";
import { describePosError } from "../lib/posErrors";
import type { POSOrderRefunds, RefundMethod } from "../lib/posContracts";
import { otherWords, problemOf, UNREACHABLE } from "../lib/problemWords";
import { businessDayWords } from "../lib/words";
import { noApproverWords } from "../register/registerWords";

export interface RefundProblem {
  kind: "network" | "supervisor" | "no-approver" | "not-allowed" | "quantity" | "drawer" | "room" | "split" | "invalid" | "other";
  words: string;
}

/** The refund codes whose detail Yetu writes for the till, and the till's words when it sends none. */
const REFUND_CODES: Record<string, { kind: RefundProblem["kind"]; words: string }> = {
  REFUND_NOT_ALLOWED: { kind: "not-allowed", words: "This order can't be refunded here." },
  REFUND_QUANTITY: { kind: "quantity", words: "That's more than is left to refund. The order has been checked again." },
  REFUND_EXCEEDS_DRAWER: { kind: "drawer", words: "There isn't enough cash in the drawer for this refund." },
  ROOM_CHARGE_PARTIAL_REFUND: {
    kind: "room",
    words: "A room charge is refunded whole, in one go. Refund every item, or refund it at the front desk.",
  },
  FOLIO_CLOSED: { kind: "room", words: "The guest's bill is closed. Refund it at the front desk." },
  REFUND_TENDER_MISMATCH: {
    kind: "split",
    words: "The money going back doesn't add up to the refund. Check how much goes back each way.",
  },
};

/** Kinds of refusal that mean the answer may have been lost on the way: the same refund goes again, under its key. */
const LOST_ANSWER = new Set(["NETWORK_ERROR", "SERVER_UNAVAILABLE", "RETRYABLE_INFRASTRUCTURE_ERROR"]);

export function refundProblem(error: unknown): RefundProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network" || LOST_ANSWER.has(describePosError(problem).kind)) return { kind: "network", words: UNREACHABLE };
  const code = problem.code ?? "";
  const known = REFUND_CODES[code];
  if (known) return { kind: known.kind, words: problem.detail?.trim() || known.words };
  switch (code) {
    case "FORBIDDEN":
      return {
        kind: "supervisor",
        words: "A different person who may approve refunds must enter their PIN. That PIN wasn't accepted, or they can't approve refunds.",
      };
    case "NO_APPROVER_SET":
      return { kind: "no-approver", words: noApproverWords("refunds") };
    case "VALIDATION_FAILED":
      return { kind: "invalid", words: "Choose at least one item and say why the money is going back, then try again." };
  }
  return { kind: "other", words: otherWords(problem, "The refund wasn't given. Try again.") };
}

/** How the money goes back, after its amount: "in cash", "by mobile money". */
const HOW: Record<RefundMethod, string> = {
  CASH: "in cash",
  MOBILE_MONEY: "by mobile money",
  BANK_TRANSFER: "by bank transfer",
  EXTERNAL_CARD: "on the card machine",
  ROOM_CHARGE: "off the room bill",
  OTHER: "the way it was paid",
};

function howWords(method: string): string {
  return Object.prototype.hasOwnProperty.call(HOW, method) ? HOW[method as RefundMethod] : HOW.OTHER;
}

function joinWords(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * What the refund being built gives back, from Yetu's quote: "Give back
 * TSh 9,500 in cash"; a split names each way; a room charge comes off the bill.
 */
export function refundSummaryWords(tenders: readonly { paymentMethod: string; amountMinor: number }[], currency: string): string {
  const giving = tenders.filter((tender) => tender.amountMinor > 0);
  if (giving.length === 0) return "";
  const total = giving.reduce((sum, tender) => sum + tender.amountMinor, 0);
  if (giving.length === 1) {
    const only = giving[0];
    if (only.paymentMethod === "ROOM_CHARGE") return `Take ${formatMoney(total, currency)} off the room bill`;
    return `Give back ${formatMoney(total, currency)} ${howWords(only.paymentMethod)}`;
  }
  return `Give back ${formatMoney(total, currency)}: ${joinWords(giving.map((tender) => `${formatMoney(tender.amountMinor, currency)} ${howWords(tender.paymentMethod)}`))}`;
}

/** A refund already given, on the order: "TSh 7,670 back in cash", "… taken off the room bill". */
export function refundGivenWords(
  totalMinor: number,
  tenders: readonly { paymentMethod: string; amountMinor: number }[],
  currency: string,
): string {
  const ways = tenders.filter((tender) => tender.amountMinor > 0);
  const amount = formatMoney(totalMinor, currency);
  if (ways.length === 1 && ways[0].paymentMethod === "ROOM_CHARGE") return `${amount} taken off the room bill`;
  const how = joinWords([...new Set(ways.map((tender) => howWords(tender.paymentMethod)))]);
  return how ? `${amount} back ${how}` : `${amount} back`;
}

/** The done screen: what Yetu recorded, and what the cashier does with the money. */
export function refundDoneWords(
  totalMinor: number,
  tenders: readonly { paymentMethod: string; amountMinor: number }[],
  currency: string,
): { title: string; lines: string[] } {
  return {
    title: `Refunded ${formatMoney(totalMinor, currency)}`,
    lines: tenders
      .filter((tender) => tender.amountMinor > 0)
      .map((tender) => {
        const amount = formatMoney(tender.amountMinor, currency);
        if (tender.paymentMethod === "CASH") return `Give ${amount} back in cash from the drawer.`;
        if (tender.paymentMethod === "ROOM_CHARGE") return `${amount} taken off the room bill.`;
        return `Give ${amount} back ${howWords(tender.paymentMethod)}.`;
      }),
  };
}

/**
 * Whether this till offers a refund on the order now, and if not, why, in
 * words. Yetu checks it all again; this only saves asking for a PIN for a
 * refund it would refuse.
 */
export function refundAvailability({
  refunds,
  shiftBusinessDate,
  canRefund,
}: {
  refunds: Pick<POSOrderRefunds, "status" | "remainingMinor" | "lastRefundDate">;
  /** The business day of this till's open shift; null with no shift open. */
  shiftBusinessDate: string | null;
  /** pos.payment.record: the cashier gives the refund (a supervisor approves it). */
  canRefund: boolean;
}): { offer: boolean; why: string | null } {
  if (refunds.status !== "CLOSED") return { offer: false, why: "Only a paid order can be refunded." };
  if (refunds.remainingMinor <= 0) return { offer: false, why: "Everything on this order has been refunded." };
  if (!canRefund) return { offer: false, why: "Only a cashier or manager can give a refund. Ask one to help." };
  if (!shiftBusinessDate) return { offer: false, why: "Open a shift on this till to give a refund." };
  if (shiftBusinessDate > refunds.lastRefundDate) {
    const last = businessDayWords(refunds.lastRefundDate);
    return { offer: false, why: last ? `Refunds for this order ended on ${last}.` : "Refunds for this order have ended." };
  }
  return { offer: true, why: null };
}
