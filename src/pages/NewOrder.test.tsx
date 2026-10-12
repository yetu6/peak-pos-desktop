import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewOrder } from "./NewOrder";
import { clearOperationalSession, setOperationalSession } from "../lib/operationalSession";
import type { POSCatalog, POSOrder } from "../lib/posContracts";

vi.mock("../lib/env", () => ({
  API_BASE_URL: "http://peak.test",
  getApiBaseUrl: () => "http://peak.test",
  REALTIME_BRIDGE_URL: "ws://localhost:5174/bridge",
  devIdentityFromEnv: () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    propertyId: "property-1",
    outletId: "outlet-1",
  }),
}));

const CATALOG: POSCatalog = {
  outletId: "outlet-1",
  outletName: "Mama Rose",
  categories: [{ id: "cat-1", outletId: "outlet-1", code: "MAINS", name: "Mains", sortOrder: 1, isActive: true }],
  products: [
    {
      id: "00000000-0000-0000-0000-000000000001",
      categoryId: "cat-1",
      code: "NC",
      name: "Nyama Choma",
      priceMinor: 1200000,
      currency: "TZS",
      taxRateBp: 1800,
      isAvailable: true,
    },
    {
      id: "00000000-0000-0000-0000-000000000006",
      categoryId: "cat-1",
      code: "TL",
      name: "Tusker Lager",
      priceMinor: 500000,
      currency: "TZS",
      taxRateBp: 1800,
      isAvailable: true,
    },
    {
      id: "00000000-0000-0000-0000-000000000009",
      categoryId: "cat-1",
      code: "HB",
      name: "House burger",
      priceMinor: 800000,
      currency: "TZS",
      taxRateBp: 1800,
      isAvailable: true,
      modifierGroups: [
        {
          id: "cook",
          productId: "00000000-0000-0000-0000-000000000009",
          name: "Cooked",
          minSelect: 1,
          maxSelect: 1,
          isActive: true,
          options: [
            { id: "opt-medium", groupId: "cook", name: "Medium", priceDeltaMinor: 0, isAvailable: true },
            { id: "opt-well", groupId: "cook", name: "Well done", priceDeltaMinor: 0, isAvailable: true },
          ],
        },
      ],
    },
  ],
};

const OPEN_ORDER: POSOrder = {
  id: "order-1",
  orderNumber: "POS-1",
  version: 2,
  shiftId: "shift-1",
  status: "OPEN",
  serviceType: "DINE_IN",
  initiatedById: "staff-1",
  initiatedByName: "Amina Hassan",
  subtotalMinor: 1016949,
  discountMinor: 0,
  discountKind: "NONE",
  discountInput: 0,
  taxMinor: 183051,
  totalMinor: 1200000,
  paidMinor: 0,
  remainingMinor: 1200000,
  items: [
    {
      id: "item-1",
      productId: "00000000-0000-0000-0000-000000000001",
      name: "Nyama Choma",
      quantity: 1,
      unitPriceMinor: 1200000,
      taxMinor: 183051,
      totalMinor: 1200000,
      status: "ADDED",
    },
  ],
};

const {
  getCurrentShiftSpy,
  getShiftSpy,
  openShiftSpy,
  closeShiftSpy,
  getCatalogSpy,
  createOrderSpy,
  addItemSpy,
  sendOrderSpy,
  removeItemSpy,
} = vi.hoisted(() => ({
  getCurrentShiftSpy: vi.fn(async () => ({
    data: {
      id: "shift-1",
      status: "OPEN",
      openingCashMinor: 0,
      expectedCashMinor: 0,
      businessDate: "2026-08-29",
      openedAt: "2026-08-29T08:00:00Z",
    },
    error: null,
  })),
  getShiftSpy: vi.fn(async () => ({
    data: {
      id: "shift-1",
      status: "OPEN",
      openingCashMinor: 0,
      expectedCashMinor: 0,
      businessDate: "2026-08-29",
      openedAt: "2026-08-29T08:00:00Z",
    },
    error: null,
  })),
  openShiftSpy: vi.fn(async () => ({
    data: {
      id: "shift-1",
      status: "OPEN",
      openingCashMinor: 0,
      expectedCashMinor: 0,
      businessDate: "2026-08-29",
      openedAt: "2026-08-29T08:00:00Z",
    },
    error: null,
  })),
  closeShiftSpy: vi.fn(async () => ({
    data: {
      id: "shift-1",
      status: "CLOSED",
      openingCashMinor: 0,
      expectedCashMinor: 0,
      businessDate: "2026-08-29",
      openedAt: "2026-08-29T08:00:00Z",
    },
    error: null,
  })),
  getCatalogSpy: vi.fn(async () => ({ data: CATALOG, error: null })),
  createOrderSpy: vi.fn(async () => ({
    data: {
      id: "order-1",
      orderNumber: "POS-1",
      version: 1,
      shiftId: "shift-1",
      status: "OPEN",
      serviceType: "DINE_IN",
  initiatedById: "staff-1",
  initiatedByName: "Amina Hassan",
      subtotalMinor: 0,
      discountMinor: 0,
      discountKind: "NONE",
      discountInput: 0,
      taxMinor: 0,
      totalMinor: 0,
      paidMinor: 0,
      remainingMinor: 0,
      items: [],
    },
    error: null,
  })),
  addItemSpy: vi.fn(async () => ({ data: OPEN_ORDER, error: null })),
  sendOrderSpy: vi.fn(async () => ({ data: { ...OPEN_ORDER, status: "SENT", version: 3 }, error: null })),
  removeItemSpy: vi.fn(async () => ({ data: { ...OPEN_ORDER, items: [], version: 3 }, error: null })),
}));

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({
    getCurrentShift: getCurrentShiftSpy,
    getShift: getShiftSpy,
    openShift: openShiftSpy,
    closeShift: closeShiftSpy,
    getCatalog: getCatalogSpy,
    createOrder: createOrderSpy,
    addItem: addItemSpy,
    sendOrder: sendOrderSpy,
    getOrder: vi.fn(async () => ({ data: OPEN_ORDER, error: null })),
    removeItem: removeItemSpy,
  }),
}));

function renderNewOrder() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <NewOrder />
    </QueryClientProvider>,
  );
}

describe("NewOrder", () => {
  beforeEach(() => {
    localStorage.clear();
    setOperationalSession({
      token: "t",
      expiresAt: "2099-01-01T00:00:00Z",
      tenantId: "tenant-1",
      propertyId: "property-1",
      outletId: "outlet-1",
      terminalId: "terminal-1",
      staffId: "staff-1",
      assurance: "RESTRICTED",
      capabilities: ["CORE", "POS"],
      permissions: [
        "pos.shift.open",
        "pos.shift.close",
        "pos.order.create",
        "pos.order.item.add",
        "pos.order.send",
        "pos.payment.record",
      ],
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearOperationalSession();
  });

  it("resumes the server current shift for selling, and shows no shift money on Sell", async () => {
    getCurrentShiftSpy.mockResolvedValueOnce({
      data: {
        id: "shift-1",
        status: "OPEN",
        openingCashMinor: 0,
        expectedCashMinor: 7_400_000,
        businessDate: "2026-08-29",
        openedAt: "2026-08-29T08:00:00Z",
      },
      error: null,
    });
    renderNewOrder();
    await waitFor(() => expect(getCurrentShiftSpy).toHaveBeenCalled());
    const tile = await screen.findByTestId("menu-Nyama Choma");
    await waitFor(() => expect(tile).toBeEnabled());
    expect(document.body).not.toHaveTextContent("74,000");
    expect(document.body).not.toHaveTextContent(/expected/i);
    expect(screen.queryByTestId("open-close-shift")).not.toBeInTheDocument();
  });

  it("keeps the ticket on screen beside the menu while browsing and searching", async () => {
    renderNewOrder();
    await screen.findByTestId("menu-Nyama Choma");
    const ticket = screen.getByTestId("ticket-panel");
    expect(screen.getByTestId("menu-grid")).toBeInTheDocument();
    await userEvent.type(screen.getByTestId("catalog-search"), "tusker");
    expect(screen.queryByTestId("menu-Nyama Choma")).not.toBeInTheDocument();
    expect(screen.getByTestId("ticket-panel")).toBe(ticket);
  });

  it("builds a live ticket through createOrder and addItem", async () => {
    renderNewOrder();
    const productTile = await screen.findByTestId("menu-Nyama Choma");
    await waitFor(() => expect(productTile).toBeEnabled());
    await userEvent.click(productTile);

    await waitFor(() => expect(createOrderSpy).toHaveBeenCalled());
    await waitFor(() => expect(addItemSpy).toHaveBeenCalled());
    expect(screen.getByTestId("cart-Nyama Choma")).toBeInTheDocument();
    expect(screen.getByTestId("cart-preview-total")).toHaveTextContent(/12[,.]000/);
    expect(screen.getByTestId("pay-order")).toBeEnabled();
  });

  it("filters the catalog locally without another catalog fetch", async () => {
    renderNewOrder();
    await screen.findByTestId("menu-Nyama Choma");
    getCatalogSpy.mockClear();
    await userEvent.type(screen.getByTestId("catalog-search"), "tusker");
    expect(await screen.findByTestId("menu-Tusker Lager")).toBeInTheDocument();
    expect(screen.queryByTestId("menu-Nyama Choma")).not.toBeInTheDocument();
    expect(getCatalogSpy).not.toHaveBeenCalled();
  });

  async function startOrder(lineName = "Nyama Choma") {
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Nyama Choma");
    await waitFor(() => expect(tile).toBeEnabled());
    await userEvent.click(tile);
    return within(screen.getByTestId("ticket-panel")).findByRole("button", { name: new RegExp(lineName) });
  }

  const ticket = () => within(screen.getByTestId("ticket-panel"));

  it("Add another repeats the selected line", async () => {
    const line = await startOrder();
    addItemSpy.mockClear();
    await userEvent.click(line);
    await userEvent.click(screen.getByRole("button", { name: "Add another" }));
    await waitFor(() =>
      expect(addItemSpy).toHaveBeenCalledWith(
        "order-1",
        expect.objectContaining({ productId: "00000000-0000-0000-0000-000000000001", quantity: 1, modifierOptionIds: [] }),
        expect.any(String),
      ),
    );
  });

  it("Add another keeps the line's options", async () => {
    addItemSpy.mockResolvedValueOnce({
      data: {
        ...OPEN_ORDER,
        items: [
          {
            id: "item-9",
            productId: "00000000-0000-0000-0000-000000000009",
            name: "House burger",
            quantity: 1,
            unitPriceMinor: 800000,
            taxMinor: 144000,
            totalMinor: 944000,
            status: "ADDED",
            modifiers: [{ id: "row-1", groupName: "Cooked", optionName: "Well done", priceDeltaMinor: 0 }],
          },
        ],
      },
      error: null,
    });
    const burger = await startOrder("House burger");
    addItemSpy.mockClear();
    await userEvent.click(burger);
    await userEvent.click(screen.getByRole("button", { name: "Add another" }));
    await waitFor(() =>
      expect(addItemSpy).toHaveBeenCalledWith(
        "order-1",
        expect.objectContaining({ productId: "00000000-0000-0000-0000-000000000009", quantity: 1, modifierOptionIds: ["opt-well"] }),
        expect.any(String),
      ),
    );
  });

  it("Remove takes an unsent line off the order", async () => {
    await userEvent.click(await startOrder());
    await userEvent.click(ticket().getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeItemSpy).toHaveBeenCalledWith("order-1", "item-1", 2, expect.any(String)));
  });

  it("sends no table for takeaway, even one typed for dine in first", async () => {
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Nyama Choma");
    await waitFor(() => expect(tile).toBeEnabled());
    await userEvent.type(screen.getByRole("textbox", { name: "Table" }), "12");
    await userEvent.click(screen.getByRole("radio", { name: "Takeaway" }));
    await userEvent.click(tile);
    await waitFor(() =>
      expect(createOrderSpy).toHaveBeenCalledWith(
        expect.objectContaining({ serviceType: "TAKEAWAY", tableLabel: undefined }),
        expect.any(String),
      ),
    );
  });

  it("an order note written before the first item goes with the order", async () => {
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Nyama Choma");
    await waitFor(() => expect(tile).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("button", { name: /Order note/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "Order note" }), "No chilli");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    await userEvent.click(tile);
    await waitFor(() =>
      expect(createOrderSpy).toHaveBeenCalledWith(expect.objectContaining({ notes: "No chilli" }), expect.any(String)),
    );
  });

  it("F9 opens Pay for the order on the ticket", async () => {
    await startOrder();
    fireEvent.keyDown(document.body, { key: "F9" });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
