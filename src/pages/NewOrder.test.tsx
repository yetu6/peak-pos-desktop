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
    {
      id: "00000000-0000-0000-0000-000000000010",
      categoryId: "cat-1",
      code: "DB",
      name: "Double burger",
      priceMinor: 1200000,
      currency: "TZS",
      taxRateBp: 1800,
      isAvailable: true,
      // Two active groups with the same name: a line's options can't be matched by name alone.
      modifierGroups: [
        {
          id: "extras-a",
          productId: "00000000-0000-0000-0000-000000000010",
          name: "Extras",
          minSelect: 0,
          maxSelect: 1,
          isActive: true,
          options: [{ id: "cheese-a", groupId: "extras-a", name: "Cheese", priceDeltaMinor: 0, isAvailable: true }],
        },
        {
          id: "extras-b",
          productId: "00000000-0000-0000-0000-000000000010",
          name: "Extras",
          minSelect: 0,
          maxSelect: 1,
          isActive: true,
          options: [{ id: "cheese-b", groupId: "extras-b", name: "Cheese", priceDeltaMinor: 50000, isAvailable: true }],
        },
      ],
    },
  ],
};

const OPEN_ORDER: POSOrder = {
  id: "order-1",
  orderNumber: "POS-1",
  dailyNumber: 1,
  createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  closedAt: null,
  payments: [],
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
  getOrderSpy,
  recordTenderSpy,
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
  getOrderSpy: vi.fn(async () => ({ data: OPEN_ORDER, error: null })),
  recordTenderSpy: vi.fn(async () => ({ data: { paymentId: "pay-1", orderClosed: true, paidMinor: 1200000, remainingMinor: 0, version: 3 }, error: null })),
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
    getOrder: getOrderSpy,
    recordTender: recordTenderSpy,
    listPrintJobs: vi.fn(async () => ({ data: [], error: null })),
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
    getOrderSpy.mockImplementation(async () => ({ data: OPEN_ORDER, error: null }));
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

  it("after payment shows Paid with the change, and New sale clears the ticket", async () => {
    await startOrder();
    // The order reads back closed once the payment is recorded (the Pay sheet also reads it on opening).
    getOrderSpy.mockImplementation(async () => ({
      data: recordTenderSpy.mock.calls.length
        ? { ...OPEN_ORDER, status: "CLOSED" as const, paidMinor: 1200000, remainingMinor: 0, version: 3 }
        : OPEN_ORDER,
      error: null,
    }));
    await userEvent.click(screen.getByTestId("pay-order"));
    await userEvent.type(screen.getByTestId("amount-received"), "15000");
    await userEvent.click(screen.getByTestId("confirm-settle"));
    const done = await screen.findByRole("dialog", { name: "Paid" });
    expect(within(done).getByTestId("done-change")).toHaveTextContent("Change to give TSh 3,000");
    await userEvent.click(within(done).getByRole("button", { name: /New sale/ }));
    expect(screen.queryByRole("dialog", { name: "Paid" })).not.toBeInTheDocument();
    expect(ticket().getByText("Tap an item to start an order.")).toBeInTheDocument();
  });

  it("Space presses a focused Send to kitchen and Pay", async () => {
    await startOrder();
    screen.getByTestId("send-order").focus();
    await userEvent.keyboard(" ");
    await waitFor(() => expect(sendOrderSpy).toHaveBeenCalled());
    const pay = screen.getByTestId("pay-order");
    await waitFor(() => expect(pay).toBeEnabled());
    pay.focus();
    await userEvent.keyboard(" ");
    expect(await screen.findByRole("dialog", { name: "Take payment" })).toBeInTheDocument();
    expect(screen.getByTestId("catalog-search")).toHaveValue("");
  });

  it("when adding from the options sheet fails, the sheet says so", async () => {
    renderNewOrder();
    const burger = await screen.findByTestId("menu-House burger");
    await waitFor(() => expect(burger).not.toHaveAttribute("aria-disabled"));
    await userEvent.click(burger);
    const sheet = await screen.findByRole("dialog", { name: "House burger" });
    addItemSpy.mockResolvedValueOnce({
      data: null,
      error: { status: 409, code: "PRODUCT_UNAVAILABLE", detail: "That item is sold out or not on this outlet's menu." },
    } as never);
    await userEvent.click(within(sheet).getByRole("radio", { name: /Medium/ }));
    await userEvent.click(within(sheet).getByTestId("modifier-confirm-add"));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("That item is sold out or not on the menu now.");
    expect(screen.getByRole("dialog", { name: "House burger" })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByTestId("menu-House burger"));
    const again = await screen.findByRole("dialog", { name: "House burger" });
    expect(within(again).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Add another asks for the options again rather than guess between groups with the same name", async () => {
    addItemSpy.mockResolvedValueOnce({
      data: {
        ...OPEN_ORDER,
        items: [
          {
            id: "item-10",
            productId: "00000000-0000-0000-0000-000000000010",
            name: "Double burger",
            quantity: 1,
            unitPriceMinor: 1200000,
            taxMinor: 0,
            totalMinor: 1200000,
            status: "ADDED",
            modifiers: [{ id: "row-1", groupName: "Extras", optionName: "Cheese", priceDeltaMinor: 0 }],
          },
        ],
      },
      error: null,
    });
    const line = await startOrder("Double burger");
    addItemSpy.mockClear();
    await userEvent.click(line);
    await userEvent.click(ticket().getByRole("button", { name: "Add another" }));
    expect(await screen.findByRole("dialog", { name: "Double burger" })).toBeInTheDocument();
    expect(addItemSpy).not.toHaveBeenCalled();
  });

  describe("refusals and recovery (S6)", () => {
    /** Yetu's refusal for a role without the permission (internal/pos/errors.go writeDomainError). */
    const FORBIDDEN = { type: "about:blank", title: "Forbidden.", status: 403, code: "FORBIDDEN", detail: "POS permission denied", request_id: "req-1" };

    async function ticketWithOneLine() {
      renderNewOrder();
      const dish = await screen.findByTestId("menu-Nyama Choma");
      await waitFor(() => expect(dish).not.toHaveAttribute("aria-disabled"));
      await userEvent.click(dish);
      await waitFor(() => expect(screen.getByTestId("send-order")).toBeEnabled());
    }

    it("a refused send says who may send, as a permission notice, never the code", async () => {
      sendOrderSpy.mockResolvedValueOnce({ data: undefined, error: FORBIDDEN } as never);
      await ticketWithOneLine();
      await userEvent.click(screen.getByTestId("send-order"));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Only staff who take orders can send them to the kitchen. Ask one to help.");
      expect(alert).toHaveClass("y-permission");
      expect(document.body).not.toHaveTextContent(/403|FORBIDDEN|permission denied/i);
    });

    it("a refused add says who may take orders, as a permission notice", async () => {
      addItemSpy.mockResolvedValueOnce({ data: undefined, error: FORBIDDEN } as never);
      renderNewOrder();
      const dish = await screen.findByTestId("menu-Nyama Choma");
      await waitFor(() => expect(dish).not.toHaveAttribute("aria-disabled"));
      await userEvent.click(dish);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Only staff who take orders can add items to an order. Ask one to help.");
      expect(alert).toHaveClass("y-permission");
    });

    it("a send whose answer was lost keeps the order and tries again with the same key", async () => {
      sendOrderSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await ticketWithOneLine();
      await userEvent.click(screen.getByTestId("send-order"));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Can't reach Yetu. Check the internet connection, then try again.");
      // The order is still on the ticket.
      expect(screen.getByTestId("ticket-panel")).toHaveTextContent("Nyama Choma");
      await userEvent.click(within(alert.closest("[data-testid=create-error]") ?? alert).getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(sendOrderSpy).toHaveBeenCalledTimes(2));
      const [first, second] = sendOrderSpy.mock.calls as unknown as Array<[string, number, string]>;
      expect(second[2]).toBe(first[2]);
      expect(second[1]).toBe(first[1]);
    });

    it("a send Yetu refused is a new request the next time", async () => {
      sendOrderSpy.mockResolvedValueOnce({ data: undefined, error: { ...FORBIDDEN, status: 409, code: "CONFLICT", detail: "x" } } as never);
      await ticketWithOneLine();
      await userEvent.click(screen.getByTestId("send-order"));
      await screen.findByRole("alert");
      await userEvent.click(screen.getByTestId("send-order"));
      await waitFor(() => expect(sendOrderSpy).toHaveBeenCalledTimes(2));
      const [first, second] = sendOrderSpy.mock.calls as unknown as Array<[string, number, string]>;
      expect(second[2]).not.toBe(first[2]);
    });
  });
});
