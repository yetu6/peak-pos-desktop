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
export type CashMovementType = "CASH_IN" | "CASH_OUT";
export type PrintJobStatus = "PENDING" | "CLAIMED" | "PRINTED" | "FAILED";

export interface POSOrderItemModifier {
  id: string;
  groupName: string;
  optionName: string;
  priceDeltaMinor: number;
}

export interface POSOrderItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  taxMinor: number;
  totalMinor: number;
  status: OrderItemStatus;
  modifiers?: POSOrderItemModifier[];
}

export interface POSOrder {
  id: string;
  shiftId: string;
  orderNumber: string;
  status: OrderStatus;
  serviceType: ServiceType;
  tableLabel?: string;
  notes?: string;
  /** Staff whose PIN session created the order. */
  initiatedById: string;
  initiatedByName: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  /** Optimistic concurrency token. Every mutation must echo the value the
   *  desktop last saw; a stale value is refused with STALE_VERSION. */
  version: number;
  items: POSOrderItem[];
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
  id: string;
  outletId: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface POSCatalog {
  outletId: string;
  outletName: string;
  categories: POSCategory[];
  products: POSCatalogProduct[];
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
}

export interface POSCashMovement {
  id: string;
  shiftId: string;
  movementType: CashMovementType;
  amountMinor: number;
  reason: string;
  recordedBy: string;
  createdAt: string;
}

export interface POSRoomChargeCandidate {
  stayId: string;
  roomId: string;
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
  orderId: string;
  orderNumber: string;
  businessDate: string;
  propertyName: string;
  outletId: string;
  outletName: string;
  terminalId: string;
  initiatedById: string;
  initiatedByName: string;
  operatorId: string;
  operatorName?: string;
  serviceType: ServiceType;
  tableLabel?: string;
  items: POSReceiptLine[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
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

export interface POSPrintJob {
  id: string;
  sourceType: string;
  sourceId: string;
  jobType: string;
  document: Record<string, unknown>;
  status: PrintJobStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
}
