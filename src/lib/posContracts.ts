/**
 * Types mirroring fbc-peak's certified POS V1 contract exactly
 * (schema 86, `api/openapi/peak.openapi.yaml`, tag `POS`). Field names and
 * shapes here are load-bearing: they are copied from the OpenAPI schemas
 * (`POSOrder`, `POSShift`, `POSCatalog`, …), not invented. Money is always
 * minor units (integer, e.g. cents) exactly as Peak sends it — this module
 * never converts to a display value; that is `posMoney.ts`'s job.
 */

export type ServiceType = "DINE_IN" | "TAKEAWAY" | "ROOM_SERVICE";
export type OrderStatus = "OPEN" | "SENT" | "PREPARING" | "READY" | "SERVED" | "CLOSED" | "VOIDED";
export type OrderItemStatus = "ADDED" | "SENT" | "VOIDED";
export type PaymentMethod = "CASH" | "MOBILE_MONEY" | "BANK_TRANSFER" | "EXTERNAL_CARD" | "OTHER";
export type ShiftStatus = "OPEN" | "PENDING_VARIANCE_APPROVAL" | "CLOSED";
/** DRAWER_OPENED (fbc-peak #289): the drawer opened without a sale, with a reason; no money. */
export type CashMovementType = "CASH_IN" | "CASH_OUT" | "DRAWER_OPENED";
/** Cash put into the drawer or taken out of it: money moves. */
export type CashMoneyType = Exclude<CashMovementType, "DRAWER_OPENED">;
/** ON_FILE (fbc-peak #288): a paid order's document, kept and never printed by itself. */
export type PrintJobStatus = "PENDING" | "CLAIMED" | "PRINTED" | "FAILED" | "ON_FILE";

export interface POSOrderItemModifier {
  id: string;
  groupName: string;
  optionName: string;
  priceDeltaMinor: number;
}

export type POSFulfilment = "PREPARED" | "PICKED" | "DIRECT";

export type PrepStation = "GENERAL" | "HOT" | "COLD" | "BAR" | "GRILL" | "PASTRY";

export interface POSOrderItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  taxMinor: number;
  totalMinor: number;
  status: OrderItemStatus;
  prepStation?: PrepStation;
  fulfilment?: POSFulfilment;
  modifiers?: POSOrderItemModifier[];
  /** S17a: the round the line was sent in; absent while it is not yet sent. */
  roundNumber?: number;
  /** F-239: taken off before it was sent (status VOIDED): when, and by whom. */
  removedAt?: string;
  removedByName?: string;
}

export interface POSStationTicket {
  id: string;
  orderId: string;
  orderNumber: string;
  /** S5b: the order's short number for its outlet and business day ("Order 42"). */
  dailyNumber: number;
  station: PrepStation;
  /** S17a: the round of the order this ticket makes; absent from a Yetu before rounds (round 1). */
  roundNumber?: number;
  status: "SENT" | "PREPARING" | "READY" | "SERVED";
  serviceType: ServiceType;
  tableLabel?: string;
  guestCount?: number;
  askForTable?: boolean;
  notes?: string;
  waiterName?: string;
  version: number;
  createdAt: string;
  /** S5b: when the ticket last moved a step (when it was sent, until it moves). */
  lastStepAt: string;
  items: POSOrderItem[];
  /** fbc-peak 00125: what this station was making and must not -- each void, as the line, of the quantity voided (status VOIDED). Absent from an older Yetu. */
  voided?: POSOrderItem[];
}

/** One item voided on an order (fbc-peak 00125): what, how many, the money taken off, why, who asked and who approved. */
export interface POSOrderVoid {
  id: string;
  itemId: string;
  name: string;
  quantity: number;
  taxMinor: number;
  totalMinor: number;
  reason: string;
  /** A line of a whole-order void, which the order's own status already tells. */
  wholeOrder: boolean;
  askedByName: string;
  approvedByName: string;
  createdAt: string;
}

/** S5b: one payment on an order, with what the till may see (never a reference, card or guest data). */
export interface POSOrderPayment {
  id: string;
  paymentMethod: PaymentMethod | "ROOM_CHARGE";
  amountMinor: number;
  /** When it was recorded. */
  createdAt: string;
  /** Who recorded it. */
  recordedByName: string;
}

export interface POSOrder {
  guestCount?: number;
  askForTable?: boolean;
  id: string;
  shiftId: string;
  /** The order's reference: unique at the property, searchable, shown small. */
  orderNumber: string;
  /** S5b: the order's short number for its outlet and business day, from 1: what staff call out ("Order 42"). */
  dailyNumber: number;
  status: OrderStatus;
  serviceType: ServiceType;
  tableLabel?: string;
  notes?: string;
  /** Staff whose PIN session created the order. */
  initiatedById: string;
  initiatedByName: string;
  subtotalMinor: number;
  discountMinor: number;
  discountKind: "NONE" | "AMOUNT" | "PERCENT";
  discountInput: number;
  discountReason?: string;
  /** F-259: when the discount was given (absent before 2026-10-20), who asked and who approved; for the history. */
  discountAppliedAt?: string;
  discountAskedByName?: string;
  discountApprovedByName?: string;
  /** F-260 (fbc-peak #286): the supervisor who approved voiding the order; a VOIDED order without one, Yetu closed with nothing on it. */
  voidApprovedByName?: string;
  /** fbc-peak #288: each bill printed before payment, oldest first, for the history. */
  billPrints?: { printedAt: string; printedByName?: string }[];
  /** fbc-peak 00125: each item voided after it was sent, and each line of a whole-order void, oldest first. */
  voids?: POSOrderVoid[];
  /** The percent discount is kept to the money off its supervisor approved; more lines would take more off (the owner, 2026-10-20). */
  discountCapped?: boolean;
  /** F-229: the order's prices hold their VAT (the property writes them so); absent from a Yetu before it: VAT on top. */
  pricesIncludeTax?: boolean;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  /**
   * S17a: rounds the order has sent to the kitchen, 0 until the first send.
   * Absent from a Yetu before rounds: then nothing can be added once sent.
   */
  roundsSent?: number;
  /** S17b: when a shift closing handed this tab over to the next shift. */
  handedOverAt?: string;
  /**
   * S17b: handed over and not yet taken by a shift: nothing is done to it
   * (TAB_WAITING_FOR_SHIFT) until this till takes it over, or the next
   * shift opened at the outlet takes it.
   */
  waitingForShift?: boolean;
  /** S10a: money given back on the order by refunds, 0 when none; absent from a Yetu before S10a. */
  refundedMinor?: number;
  /** Optimistic concurrency token. Every mutation must echo the value the
   *  desktop last saw; a stale value is refused with STALE_VERSION. */
  version: number;
  /** S5b: when the order was opened on the till. */
  createdAt: string;
  /** S5b: when it was paid in full or charged to a room (for a voided order, when it was voided); null while open. */
  closedAt: string | null;
  /** S5b: the money recorded against it, oldest first. */
  payments: POSOrderPayment[];
  items: POSOrderItem[];
}

/** S5b: one page of the till's orders list (GET /pos/orders?view=open|paid). */
export interface POSOrderPage {
  items: POSOrder[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
  /** view=paid: the business day listed. */
  businessDate?: string;
}

export type DiscountKind = "AMOUNT" | "PERCENT";

export interface POSTenderResult {
  paymentId: string;
  orderClosed: boolean;
  paidMinor: number;
  remainingMinor: number;
  version: number;
}

export interface POSModifierOption {
  id: string;
  groupId: string;
  name: string;
  priceDeltaMinor: number;
  isAvailable: boolean;
}

export interface POSModifierGroup {
  id: string;
  productId: string;
  name: string;
  minSelect: number;
  maxSelect?: number;
  isActive: boolean;
  options?: POSModifierOption[];
}

export interface POSCatalogProduct {
  fulfilment?: POSFulfilment;
  id: string;
  categoryId?: string;
  code: string;
  name: string;
  priceMinor: number;
  currency: string;
  taxRateBp: number;
  /** False when 86'd / sold out for this outlet. */
  isAvailable: boolean;
  modifierGroups?: POSModifierGroup[];
}

export interface POSCategory {
  fulfilment?: POSFulfilment;
  id: string;
  outletId: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface POSCatalog {
  askForTable?: boolean;
  captureGuestCount?: boolean;
  standardFloat?: number;
  quickCashNotes?: number[];
  outletId: string;
  outletName: string;
  categories: POSCategory[];
  products: POSCatalogProduct[];
}

/** What a supervisor approves (Team rules; fbc-peak approval_kinds). */
export type ApprovalKind = "VOID" | "REFUND" | "DISCOUNT" | "CASH_OUT" | "SHIFT_VARIANCE";

/** `GET /pos/approvers` (F-249): someone whose approval can succeed here, and for what. */
export interface POSApprover {
  staffId: string;
  approves: ApprovalKind[];
}

export interface POSShift {
  id: string;
  status: ShiftStatus;
  openingCashMinor: number;
  /** Server-computed: opening float + cash tenders + cash-in - cash-out. */
  expectedCashMinor: number;
  countedCashMinor?: number;
  varianceMinor?: number;
  /** Snapshotted from the property's authoritative business date at OpenShift. */
  businessDate: string;
  openedAt: string;
  /** S17b: on a closed shift, the tabs it handed over to the next shift and what they owed. */
  handedOverTabs?: number;
  handedOverOwedMinor?: number;
  /** S17b: on opening, the waiting tabs this shift took over. */
  takenOverTabs?: number;
}

export interface POSCashMovement {
  id: string;
  shiftId: string;
  movementType: CashMovementType;
  amountMinor: number;
  reason: string;
  recordedBy: string;
  /** Who recorded it, by name (fbc-peak F-272). */
  recordedByName?: string;
  /** Who approved a cash out, by name; never their id (2026-10-27). */
  authorizedByName?: string;
  createdAt: string;
}

/** A room an order can be charged to: never the room's own id or the guest's bill (2026-10-27). */
export interface POSRoomChargeCandidate {
  stayId: string;
  roomNumber: string;
  guestDisplayName: string;
  postingEligible: boolean;
}

export interface POSReceiptLine {
  name: string;
  quantity: number;
  unitPriceMinor: number;
  taxMinor: number;
  totalMinor: number;
  modifiers?: POSOrderItemModifier[];
}

export interface POSReceiptDocument {
  guestCount?: number;
  askForTable?: boolean;
  orderId: string;
  orderNumber: string;
  /** S5b: the order's short number, on receipts made from S5b on (absent on earlier ones). */
  dailyNumber?: number;
  businessDate: string;
  propertyName: string;
  outletName: string;
  /** People come by name only; the till and outlet ids are not on it (2026-10-27). */
  initiatedByName: string;
  operatorName?: string;
  serviceType: ServiceType;
  tableLabel?: string;
  items: POSReceiptLine[];
  subtotalMinor: number;
  /** S8b: what came off the order (absent when nothing did), and why. */
  discountMinor?: number;
  discountReason?: string;
  taxMinor: number;
  totalMinor: number;
  /** F-229: the receipt's prices hold their VAT. */
  pricesIncludeTax?: boolean;
  currency: string;
  tenderMethod: string;
  settledAt: string;
}

export interface POSReceipt {
  id: string;
  orderId: string;
  status: PrintJobStatus;
  reprintedFromId?: string;
  reprintCount: number;
  createdAt: string;
  document: POSReceiptDocument;
}

export interface POSBusinessDayCloseResult {
  businessDate: string;
  nextBusinessDate: string;
  shiftsClosed: number;
  settledAmountMinor: number;
  closedAt: string;
}

/** One paper as it would print (previewPOSPapers): its kind and document, as a print job's. */
export interface POSPaper {
  jobType: "KITCHEN_TICKET" | "BILL";
  document: Record<string, unknown>;
}

export interface POSPrintJob {
  claimedByTerminalId?: string;
  id: string;
  sourceType: string;
  sourceId: string;
  jobType: string;
  document: Record<string, unknown>;
  status: PrintJobStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  /** S8b: on a copy, its original (a till opens no cash drawer for a copy). */
  reprintedFromId?: string;
}

/** S8a: a round's kitchen tickets printed again, each marked COPY (reprintPOSKitchenTickets). */
export interface POSKitchenReprint {
  roundNumber: number;
  printJobs: POSPrintJob[];
}

// ---------------------------------------------------------------------------
// S7 refunds by item (fbc-peak #254): GET/POST /pos/orders/{orderId}/refunds,
// POST /pos/orders/{orderId}/refunds/quote. Every amount is the server's.
// ---------------------------------------------------------------------------

/** The ways money goes back: the ways it was paid, a room charge among them. */
export type RefundMethod = PaymentMethod | "ROOM_CHARGE";

export interface POSRefundLine {
  orderItemId: string;
  name: string;
  quantity: number;
  /** Quantity at the price sold. */
  grossMinor: number;
  discountMinor: number;
  /** grossMinor - discountMinor. */
  netMinor: number;
  taxMinor: number;
  /** netMinor + taxMinor. */
  totalMinor: number;
}

export interface POSRefundTender {
  paymentId: string;
  paymentMethod: RefundMethod;
  amountMinor: number;
}

/** POSRefund: one refund as given. */
export interface POSRefund {
  id: string;
  orderId: string;
  orderNumber: string;
  dailyNumber: number;
  /** The refunding shift's business date: reports count the refund on this day. */
  businessDate: string;
  reason: string;
  /** Who asked and who approved, by name; never their ids, the till, shift or outlet (2026-10-27). */
  initiatedByName: string;
  authorizedByName: string;
  netMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  createdAt: string;
  lines: POSRefundLine[];
  tenders: POSRefundTender[];
}

/** listPOSOrderRefunds: what was given back on an order, and what is left to give. */
export interface POSOrderRefunds {
  orderId: string;
  status: OrderStatus;
  totalMinor: number;
  refundedMinor: number;
  /** Left to refund; zero unless CLOSED. */
  remainingMinor: number;
  /** The last business date the till may refund this order. */
  lastRefundDate: string;
  /** Charged to a room: refunded whole, in one go, or at the front desk. */
  wholeOrderOnly: boolean;
  refunds: POSRefund[];
  lines: { orderItemId: string; name: string; quantity: number; refundedQuantity: number; remainingQuantity: number }[];
  payments: { paymentId: string; paymentMethod: string; amountMinor: number; refundedMinor: number; remainingMinor: number }[];
}

export interface POSRefundLineRequest {
  orderItemId: string;
  quantity: number;
}

export interface POSRefundTenderRequest {
  paymentId: string;
  amountMinor: number;
}

/** POSRefundQuoteRequest: recordPOSRefund's body without the supervisor. */
export interface POSRefundQuoteRequest {
  /** Accepted so the till can send the refund it is building; not used by the quote. */
  reason?: string;
  lines: POSRefundLineRequest[];
  /** Must add up to the refund exactly. Leave out for the proposed split. */
  tenders?: POSRefundTenderRequest[];
}

export interface POSRefundQuoteLine {
  orderItemId: string;
  name: string;
  quantity: number;
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface POSRefundQuoteTender {
  paymentId: string;
  paymentMethod: RefundMethod;
  /** What this refund would give back on the payment (0 for none). */
  amountMinor: number;
  /** The most it can. */
  capMinor: number;
}

/** POSRefundQuote: what a refund would give back, worked out by the server, nothing written. */
export interface POSRefundQuote {
  orderId: string;
  currency: string;
  netMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  /** What would leave this till's drawer. */
  cashMinor: number;
  wholeOrderOnly: boolean;
  lines: POSRefundQuoteLine[];
  /** Every payment that can still give money back. */
  tenders: POSRefundQuoteTender[];
}

/** recordPOSRefund's body. */
export interface POSRefundRequest {
  reason: string;
  lines: POSRefundLineRequest[];
  /** Leave out when the order was paid one way. */
  tenders?: POSRefundTenderRequest[];
  supervisorStaffId: string;
  supervisorPin: string;
}

/** The most of one item a line holds: fbc-peak's MaxLineQuantity, the contract's maximum on adding and on a quantity change. */
export const MAX_LINE_QUANTITY = 999;
