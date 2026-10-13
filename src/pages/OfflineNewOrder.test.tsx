import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { idleLockHeld } from "../lib/idleLock";
import type { LocalCatalogView, LocalOrderView, OfflineCashCommitResult } from "../lib/localPosCore";
import { clearOperationalSession, setOperationalSession } from "../lib/operationalSession";
import { OfflineNewOrder } from "./OfflineNewOrder";

/**
 * The offline register over the certified local store. Every shape here is
 * the Rust store's own (src-tauri local_store: LocalCatalogView,
 * LocalOrderView, OfflineCashCommitResult); a refusal is the store's error
 * kind as Tauri rejects it (SCREAMING_SNAKE_CASE).
 */

const CATALOG: LocalCatalogView = {
  snapshotId: "snap-7",
  version: "2026-10-12T05:00:00Z",
  currency: "TZS",
  taxMode: "EXCLUSIVE",
  serviceTypes: [
    { id: "DINE_IN", label: "Dine in", requiresContext: true },
    { id: "TAKEAWAY", label: "Takeaway", requiresContext: false },
  ],
  categories: [{ id: "cat-mains", code: "MAINS", name: "Mains" }],
  products: [
    { id: "prod-chips", categoryId: "cat-mains", code: "CHIPS", name: "Chips", priceMinor: 500_000, taxRateBp: 1800, currency: "TZS", modifierGroups: [] },
    {
      id: "prod-pilau",
      categoryId: "cat-mains",
      code: "PILAU",
      name: "Pilau",
      priceMinor: 1_200_000,
      taxRateBp: 1800,
      currency: "TZS",
      modifierGroups: [
        {
          id: "grp-meat",
          name: "Meat",
          minSelect: 1,
          maxSelect: 1,
          options: [
            { id: "opt-beef", name: "Beef", priceDeltaMinor: 0 },
            { id: "opt-goat", name: "Goat", priceDeltaMinor: 200_000 },
          ],
        },
      ],
    },
  ],
};

function draft(lines: LocalOrderView["lines"] = [], extra: Partial<LocalOrderView> = {}): LocalOrderView {
  const subtotal = lines.reduce((sum, line) => sum + line.pricing.lineSubtotalMinor, 0);
  const tax = lines.reduce((sum, line) => sum + line.pricing.lineTaxMinor, 0);
  return {
    id: "local-order-1",
    state: "DRAFT",
    syncState: "LOCAL_DRAFT",
    version: 1 + lines.length,
    staffId: "staff-amina",
    serviceType: "DINE_IN",
    currency: "TZS",
    subtotalMinor: subtotal,
    taxMinor: tax,
    totalMinor: subtotal + tax,
    lines,
    ...extra,
  };
}

/** Chips at TSh 5,000 with 18% VAT on top: TSh 5,900 a portion. */
function chips(quantity: number): LocalOrderView["lines"][number] {
  return {
    id: "line-chips",
    productId: "prod-chips",
    name: "Chips",
    quantity,
    unitPriceMinor: 500_000,
    modifierTotalMinor: 0,
    lineTotalMinor: 590_000 * quantity,
    pricing: {
      unitNetMinor: 500_000,
      unitTaxMinor: 90_000,
      unitTotalMinor: 590_000,
      lineSubtotalMinor: 500_000 * quantity,
      lineTaxMinor: 90_000 * quantity,
      lineTotalMinor: 590_000 * quantity,
    },
    modifiers: [],
  };
}

const core = vi.hoisted(() => ({
  catalog: vi.fn(),
  getOrCreateDraft: vi.fn(),
  addItem: vi.fn(),
  setQuantity: vi.fn(),
  removeLine: vi.fn(),
  updateContext: vi.fn(),
  commitOrder: vi.fn(),
  settleCash: vi.fn(),
  retrySync: vi.fn(),
  syncState: vi.fn(),
}));

vi.mock("../lib/localPosCore", () => ({ loadLocalPosCore: async () => core }));

function renderRegister() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OfflineNewOrder />
    </QueryClientProvider>,
  );
}

async function addChips() {
  const tile = await screen.findByTestId("menu-Chips");
  await waitFor(() => expect(tile).not.toBeDisabled());
  await userEvent.click(tile);
  await screen.findByTestId("cart-Chips");
}

beforeEach(() => {
  setOperationalSession({
    token: "",
    expiresAt: "2099-01-01T00:00:00Z",
    tenantId: "offline-local",
    propertyId: "property-1",
    outletId: "outlet-1",
    terminalId: "terminal-1",
    staffId: "staff-amina",
    assurance: "RESTRICTED",
    mode: "offline-cash",
    capabilities: ["CORE", "POS"],
    permissions: [],
  });
  // Like the Rust store (local_store/orders.rs), every change names the version it expects and is
  // refused STALE_DRAFT otherwise; each accepted change moves the version on by one.
  let current = draft();
  const expectVersion = (version: number) => {
    if (version !== current.version) throw "STALE_DRAFT";
  };
  core.catalog.mockImplementation(async () => CATALOG);
  core.getOrCreateDraft.mockImplementation(async () => current);
  core.addItem.mockImplementation(async (intent: { expectedVersion: number }) => {
    expectVersion(intent.expectedVersion);
    return (current = draft([chips(2)]));
  });
  core.setQuantity.mockImplementation(async (_order: string, _line: string, quantity: number, version: number) => {
    expectVersion(version);
    return (current = { ...draft([chips(quantity)]), version: current.version + 1 });
  });
  core.removeLine.mockImplementation(async (_order: string, _line: string, version: number) => {
    expectVersion(version);
    return (current = { ...draft([]), version: current.version + 1 });
  });
  core.updateContext.mockImplementation(async (intent: { expectedVersion: number }) => {
    expectVersion(intent.expectedVersion);
    return (current = { ...current, version: current.version + 1 });
  });
  core.commitOrder.mockImplementation(async (_order: string, version: number) => {
    expectVersion(version);
    return (current = { ...current, state: "COMMITTED", version: current.version + 1 });
  });
  core.settleCash.mockImplementation(
    async (_order: string, version: number, cashReceivedMinor: number): Promise<OfflineCashCommitResult> => {
      expectVersion(version);
      return {
      order: (current = { ...current, state: "SETTLED", syncState: "SYNC_PENDING", orderNumber: "OFF-0007" }),
      localSettlementId: "settle-1",
      amountDueMinor: current.totalMinor,
      cashReceivedMinor,
      changeMinor: cashReceivedMinor - current.totalMinor,
      operationId: "op-1",
      syncState: "QUEUED",
      };
    },
  );
  core.retrySync.mockRejectedValue("SYNC_UNAVAILABLE");
});

afterEach(() => {
  vi.clearAllMocks();
  clearOperationalSession();
});

describe("the offline register", () => {
  it("has Sell's layout and only what the offline protocol certifies", async () => {
    renderRegister();
    await addChips();
    expect(screen.getByTestId("register")).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Menu categories" })).toBeInTheDocument();
    expect(screen.getByTestId("ticket-panel")).toHaveTextContent("Chips");
    // Cash only: no kitchen, no other way to pay, no discount or void, no sold out.
    expect(screen.queryByTestId("send-order")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /More/ })).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId("menu-Chips"));
    expect(screen.queryByRole("dialog", { name: /sold out/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("offline-pay")).toHaveTextContent("Take TSh 11,800 cash");
  });

  it("changes the quantity and removes a line through the local store", async () => {
    renderRegister();
    await addChips();
    await userEvent.click(screen.getByTestId("cart-Chips").querySelector("button")!);
    await userEvent.click(screen.getByRole("button", { name: "One more Chips" }));
    await waitFor(() => expect(core.setQuantity).toHaveBeenCalledWith("local-order-1", "line-chips", 3, 2));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(core.removeLine).toHaveBeenCalled());
  });

  it("takes cash in money words, not minor units, and says the sale is saved with the change", async () => {
    renderRegister();
    await addChips();
    await userEvent.click(screen.getByTestId("offline-pay"));
    const sheet = await screen.findByRole("dialog", { name: "Take cash" });
    expect(within(sheet).getByTestId("amount-due")).toHaveTextContent("TSh 11,800");
    await userEvent.type(within(sheet).getByTestId("offline-cash-received"), "20000");
    expect(within(sheet).getByTestId("change-due")).toHaveTextContent("Change to give TSh 8,200");
    await userEvent.click(within(sheet).getByTestId("confirm-offline-cash"));
    await waitFor(() => expect(core.settleCash).toHaveBeenCalledWith("local-order-1", 3, 2_000_000));
    expect(core.commitOrder).toHaveBeenCalledTimes(1);
    const saved = await screen.findByTestId("offline-sale-saved-line");
    expect(saved).toHaveAttribute("role", "status");
    expect(saved).toHaveTextContent("Sale saved on this till · Change TSh 8,200");
    expect(screen.getByTestId("offline-sale-saved")).toHaveTextContent("Waiting to send to Yetu");
    await userEvent.click(screen.getByRole("button", { name: "New sale" }));
    expect(screen.queryByTestId("offline-sale-saved")).not.toBeInTheDocument();
  });

  it("offline, a sale is paid in full in cash", async () => {
    renderRegister();
    await addChips();
    await userEvent.click(screen.getByTestId("offline-pay"));
    const sheet = await screen.findByRole("dialog", { name: "Take cash" });
    await userEvent.type(within(sheet).getByTestId("offline-cash-received"), "5000");
    expect(within(sheet).getByTestId("change-due")).toHaveTextContent("Offline, a sale is paid in full in cash. TSh 6,800 more is needed.");
    expect(within(sheet).getByTestId("confirm-offline-cash")).toBeDisabled();
  });

  it("Exact takes the amount due; Enter takes the cash", async () => {
    renderRegister();
    await addChips();
    await userEvent.click(screen.getByTestId("offline-pay"));
    const sheet = await screen.findByRole("dialog", { name: "Take cash" });
    await userEvent.click(within(sheet).getByRole("button", { name: /^Exact/ }));
    await userEvent.type(within(sheet).getByTestId("offline-cash-received"), "{Enter}");
    await waitFor(() => expect(core.settleCash).toHaveBeenCalledWith("local-order-1", 3, 1_180_000));
    expect(await screen.findByTestId("offline-sale-saved-line")).toHaveTextContent("Sale saved on this till · No change to give");
  });

  it("while the sale is being saved the sheet stays and the till doesn't lock", async () => {
    let finish: (value: OfflineCashCommitResult) => void = () => undefined;
    core.settleCash.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    renderRegister();
    await addChips();
    await userEvent.click(screen.getByTestId("offline-pay"));
    const sheet = await screen.findByRole("dialog", { name: "Take cash" });
    await userEvent.click(within(sheet).getByRole("button", { name: /^Exact/ }));
    await userEvent.click(within(sheet).getByTestId("confirm-offline-cash"));
    await waitFor(() => expect(core.settleCash).toHaveBeenCalled());
    expect(idleLockHeld()).toBe(true);
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Take cash" })).toBeInTheDocument();
    await act(async () =>
      finish({ order: draft([chips(2)], { state: "SETTLED" }), localSettlementId: "s", amountDueMinor: 1_180_000, cashReceivedMinor: 1_180_000, changeMinor: 0, operationId: "op", syncState: "QUEUED" }),
    );
    expect(idleLockHeld()).toBe(false);
  });

  it("says a refusal of the local store in words, with what to do", async () => {
    core.settleCash.mockRejectedValueOnce("LIMIT_EXCEEDED");
    renderRegister();
    await addChips();
    await userEvent.click(screen.getByTestId("offline-pay"));
    const sheet = await screen.findByRole("dialog", { name: "Take cash" });
    await userEvent.click(within(sheet).getByRole("button", { name: /^Exact/ }));
    await userEvent.click(within(sheet).getByTestId("confirm-offline-cash"));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "This till has reached its limit for working offline. The sale wasn't saved. Reconnect to Yetu to carry on.",
    );
    expect(document.body).not.toHaveTextContent("LIMIT_EXCEEDED");
  });

  it("an item with options asks for them first (Yetu's options, saved with the menu)", async () => {
    renderRegister();
    const tile = await screen.findByTestId("menu-Pilau");
    await waitFor(() => expect(tile).not.toBeDisabled());
    await userEvent.click(tile);
    const sheet = await screen.findByRole("dialog", { name: "Pilau" });
    await userEvent.click(within(sheet).getByRole("radio", { name: /Goat/ }));
    await userEvent.click(within(sheet).getByTestId("modifier-confirm-add"));
    await waitFor(() =>
      expect(core.addItem).toHaveBeenCalledWith(expect.objectContaining({ productId: "prod-pilau", quantity: 1, modifierOptionIds: ["opt-goat"], expectedVersion: 1 })),
    );
  });

  it("says when this till has no menu saved for working offline", async () => {
    core.catalog.mockRejectedValue("CATALOG_REQUIRED");
    renderRegister();
    expect(await screen.findByText("No menu saved for working offline")).toBeInTheDocument();
    expect(screen.getByText("Connect to Yetu once so this till can save the menu, then try again.")).toBeInTheDocument();
  });
});
