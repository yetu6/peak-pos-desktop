/**
 * Yetu's refusals as the till receives them since S5b (fbc-peak #257, internal/pos/errors.go) and the
 * approvers rule (#258, controls.go): status, code, title and detail exactly as the backend writes them, wrapped
 * the way the till's hooks reject (usePosData `unwrap`: the problem as JSON in an Error's message).
 *
 * The till words a refusal by its code. The details are kept here only so a test shows the code, not the
 * sentence, decides: a word module must give the same words whatever the detail says.
 */
export interface YetuProblem {
  type: string;
  status: number;
  code: string;
  title: string;
  detail: string;
  request_id: string;
}

function refusal(status: number, code: string, title: string, detail: string): YetuProblem {
  return { type: "about:blank", status, code, title, detail, request_id: "req-test" };
}

/** As a rejected hook call carries it. */
export function rejected(problem: YetuProblem): Error {
  return new Error(JSON.stringify(problem));
}

/** The same refusal with a detail the till has never seen: the words must not change. */
export function reworded(problem: YetuProblem): YetuProblem {
  return { ...problem, detail: "A sentence Yetu may write differently one day." };
}

const STATE = "This order is not at the step this needs.";

export const REFUSED = {
  // Payments (controls.go RecordTender)
  tenderAlreadyPaid: refusal(409, "ORDER_ALREADY_PAID", "Nothing is left to pay on this order.", "order remaining balance is already settled"),
  tenderTooMuch: refusal(422, "TENDER_EXCEEDS_BALANCE", "That is more than is still owed.", "tender exceeds remaining balance"),
  tenderOrderClosed: refusal(409, "ORDER_STATE_CHANGED", STATE, "tender cannot be recorded on a closed or voided order"),
  // Room charge (operations.go ChargeRoom)
  roomPartPaid: refusal(409, "ORDER_HAS_PAYMENT", "Part of this order is already paid.", "room charge cannot follow a partial tender"),
  roomNotEligible: refusal(409, "ORDER_STATE_CHANGED", STATE, "order is not eligible for room charge"),
  roomFolioNotOpen: refusal(409, "FOLIO_NOT_OPEN", "The guest's bill is not open.", "active stay with open folio not found"),
  // Discount (commerce.go ApplyDiscount)
  discountPartPaid: refusal(409, "ORDER_HAS_PAYMENT", "Part of this order is already paid.", "discount cannot be changed after a tender has been recorded"),
  discountOrderClosed: refusal(409, "ORDER_STATE_CHANGED", STATE, "A discount cannot be given on an order that is paid or voided."),
  // Void (controls.go VoidOrder; a part-paid order is still INVALID_STATE)
  voidPartPaid: refusal(409, "INVALID_STATE", "Invalid state", "This order has already taken payment, so it can no longer be voided or have items removed."),
  voidOrderClosed: refusal(409, "ORDER_STATE_CHANGED", STATE, "closed or voided order requires a refund workflow"),
  // Approvals (#258): nobody chosen to approve this kind here.
  noApproverVoids: refusal(409, "NO_APPROVER_SET", "No one can approve this here yet.", "No one is set to approve voids here yet. The owner chooses in Team rules."),
  // Shift close (controls.go CloseShift)
  shiftHasOpenOrders: refusal(409, "SHIFT_HAS_OPEN_ORDERS", "Orders on this shift are still open.", "shift has open orders"),
  shiftOfflineCash: refusal(409, "SHIFT_OFFLINE_CASH_UNRESOLVED", "Cash taken offline is not settled yet.", "shift has unresolved offline cash"),
  shiftNotOpen: refusal(409, "SHIFT_NOT_OPEN", "No shift is open on this till.", "shift is not open"),
  // Cash in and out (cash.go)
  cashNoShift: refusal(409, "SHIFT_NOT_OPEN", "No shift is open on this till.", "no open shift on this terminal"),
  // Selling (operations.go)
  createShiftNotOpen: refusal(409, "SHIFT_NOT_OPEN", "No shift is open on this till.", "That shift is not open on this till. Open a shift here first."),
  addSoldOut: refusal(409, "PRODUCT_UNAVAILABLE", "That item is not available.", "That item is sold out or not on this outlet's menu."),
  addOrderSent: refusal(409, "ORDER_STATE_CHANGED", STATE, "Items can only be added to an order that has not been sent. Start a new order for more."),
  sendEmpty: refusal(409, "ORDER_EMPTY", "There is nothing on this order to send.", "Add something to the order before sending it."),
  sendOrderMoved: refusal(409, "ORDER_STATE_CHANGED", STATE, "This order has already been sent, paid or voided."),
  removeSent: refusal(409, "ITEM_NOT_REMOVABLE", "This item can no longer be removed.", "Only an item not yet sent to the kitchen, on an open order, can be removed."),
  // Kitchen (stations.go / operations.go TransitionOrder)
  ticketMoved: refusal(409, "TICKET_STATE_CHANGED", "This ticket is not at the step this needs.", "This ticket is not at the step before ready."),
  orderStepMoved: refusal(409, "ORDER_STATE_CHANGED", STATE, "This order is not at the step before ready: it has moved on, or was paid or voided."),
} as const;
