import type { LocalCatalogView, LocalOrderView, OfflineCashCommitResult, SyncState } from "../lib/localPosCore";
import { CATEGORIES, CURRENCY, PRODUCTS } from "./registerData";

/**
 * The offline and sync fixtures' data in the till store's own shapes
 * (src-tauri local_store: LocalCatalogView, LocalOrderView,
 * OfflineCashCommitResult, SyncState): the Sell fixtures' menu as saved for
 * working offline, one offline sale, and the store's sync states.
 */

export const LOCAL_CATALOG: LocalCatalogView = {
  snapshotId: "snap-2026-10-12-0700",
  version: "2026-10-12T04:00:00Z",
  currency: CURRENCY,
  taxMode: "EXCLUSIVE",
  serviceTypes: [
    { id: "DINE_IN", label: "Dine in", requiresContext: true },
    { id: "TAKEAWAY", label: "Takeaway", requiresContext: false },
  ],
  categories: CATEGORIES.map((category) => ({ id: category.id, code: category.code, name: category.name })),
  products: PRODUCTS.filter((product) => product.isAvailable).map((product) => ({
    id: product.id,
    categoryId: product.categoryId,
    code: product.code,
    name: product.name,
    priceMinor: product.priceMinor,
    taxRateBp: product.taxRateBp,
    currency: product.currency,
    modifierGroups: (product.modifierGroups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect ?? group.options?.length ?? 1,
      options: (group.options ?? []).map((option) => ({ id: option.id, name: option.name, priceDeltaMinor: option.priceDeltaMinor })),
    })),
  })),
};

/** A line as the store prices it: the price, VAT at the item's rate on top, times the quantity. */
function localLine(id: string, productId: string, quantity: number): LocalOrderView["lines"][number] {
  const product = LOCAL_CATALOG.products.find((entry) => entry.id === productId)!;
  const unitTax = Math.round((product.priceMinor * product.taxRateBp) / 10_000);
  return {
    id,
    productId,
    name: product.name,
    quantity,
    unitPriceMinor: product.priceMinor,
    modifierTotalMinor: 0,
    lineTotalMinor: (product.priceMinor + unitTax) * quantity,
    pricing: {
      unitNetMinor: product.priceMinor,
      unitTaxMinor: unitTax,
      unitTotalMinor: product.priceMinor + unitTax,
      lineSubtotalMinor: product.priceMinor * quantity,
      lineTaxMinor: unitTax * quantity,
      lineTotalMinor: (product.priceMinor + unitTax) * quantity,
    },
    modifiers: [],
  };
}

const LINES = [localLine("line-1", "nyama", 1), localLine("line-2", "tusker", 2), localLine("line-3", "juice", 1)];

export const LOCAL_SALE: LocalOrderView = {
  id: "local-7f3k9abc",
  state: "DRAFT",
  syncState: "LOCAL_DRAFT",
  version: 4,
  staffId: "staff-amina",
  serviceType: "DINE_IN",
  tableLabel: "7",
  currency: CURRENCY,
  subtotalMinor: LINES.reduce((sum, line) => sum + line.pricing.lineSubtotalMinor, 0),
  taxMinor: LINES.reduce((sum, line) => sum + line.pricing.lineTaxMinor, 0),
  totalMinor: LINES.reduce((sum, line) => sum + line.lineTotalMinor, 0),
  lines: LINES,
};

export const EMPTY_SALE: LocalOrderView = { ...LOCAL_SALE, version: 1, tableLabel: undefined, subtotalMinor: 0, taxMinor: 0, totalMinor: 0, lines: [] };

/** The guest hands over the next ten thousand above the bill. */
export const OFFLINE_CASH_RECEIVED = (Math.floor(LOCAL_SALE.totalMinor / 1_000_000) + 1) * 1_000_000;

export const SAVED_SALE: OfflineCashCommitResult = {
  order: { ...LOCAL_SALE, state: "SETTLED", syncState: "SYNC_PENDING", version: 6 },
  localSettlementId: "settle-2c4e",
  amountDueMinor: LOCAL_SALE.totalMinor,
  cashReceivedMinor: OFFLINE_CASH_RECEIVED,
  changeMinor: OFFLINE_CASH_RECEIVED - LOCAL_SALE.totalMinor,
  operationId: "op-9d1a",
  syncState: "QUEUED",
};

const LAST_SENT = new Date(2026, 9, 12, 14, 2).getTime();

export const SYNC_WAITING: SyncState = {
  status: "Offline · 3 waiting",
  queuedOperations: 3,
  reconciledOperations: 12,
  exceptionOperations: 0,
  lastSuccessAtMs: LAST_SENT,
  lastAttemptAtMs: new Date(2026, 9, 12, 14, 30).getTime(),
  leaseStatus: "ACTIVE",
  catalogStatus: "ACTIVE",
  shiftOfflineEligible: true,
};

export const SYNC_PROBLEM: SyncState = { ...SYNC_WAITING, status: "Sync issue", queuedOperations: 0, reconciledOperations: 15, exceptionOperations: 2 };
