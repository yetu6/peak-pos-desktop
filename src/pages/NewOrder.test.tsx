import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RealtimeClient } from "../realtime/RealtimeClient";
import { RealtimeProvider } from "../realtime/RealtimeProvider";
import { NewOrder } from "./NewOrder";
import { REGISTER_AUTO_RETURN_SECONDS, REGISTER_QUIET_AFTER_RETURN_MS } from "../register/registerSettings";
import { clearOperationalSession, getOperationalSession, setOperationalSession } from "../lib/operationalSession";
import type { POSCatalog, POSOrder } from "../lib/posContracts";
import { giveReason } from "../../tests/reasons";

// The printer: done at once unless a test holds it.
const { printForSpy, printJobNowSpy, printBillSpy } = vi.hoisted(() => ({
  printForSpy: vi.fn(async () => [] as unknown[]),
  printJobNowSpy: vi.fn(async (..._args: unknown[]) => ({ ok: true }) as { ok: boolean; error?: string }),
  printBillSpy: vi.fn(async (orderId: string, ..._rest: unknown[]) => ({
    data: { id: `bill-${orderId}`, sourceType: "POS_ORDER", sourceId: orderId, jobType: "BILL", document: { kind: "BILL" }, status: "PENDING", attempts: 0, createdAt: "2026-10-20T17:20:00Z" },
    error: null,
  })),
}));
vi.mock("../print/printFor", () => ({ printFor: printForSpy, printJobNow: printJobNowSpy }));
vi.mock("../print/printerStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../print/printerStore")>()),
  loadPrinterSettings: async () => ({ kitchenTickets: true, kitchen: null, stations: {}, receipt: null, cashDrawer: false }),
}));
const { reprintKitchenSpy, listOrderPageSpy } = vi.hoisted(() => ({
  reprintKitchenSpy: vi.fn(async (..._args: unknown[]) => ({ data: { roundNumber: 1, printJobs: [] }, error: null })),
  listOrderPageSpy: vi.fn(async (..._args: unknown[]) => ({ data: { items: [] as unknown[], nextCursor: null }, error: null })),
}));
const { openDrawerSpy } = vi.hoisted(() => ({ openDrawerSpy: vi.fn(async (..._args: unknown[]) => ({ ok: true })) }));
vi.mock("../print/cashDrawer", () => ({ openDrawerForCash: openDrawerSpy }));

// Supervisors at this till, for Void and Discount.
vi.mock("../auth/DeviceSessionProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/DeviceSessionProvider")>()),
  useDeviceSessionOptional: () => ({
    session: { staffId: "staff-1" },
    roster: [
      { fullName: "Amina Hassan", staffNumber: "staff-1" },
      { fullName: "Grace Mushi", staffNumber: "staff-2" },
    ],
  }),
}));

// The Restaurant & Bar module's menu for the outlet: none unless a test sets one.
const { tillMenu } = vi.hoisted(() => ({ tillMenu: { data: undefined as unknown } }));
vi.mock("../fnb/useTillMenu", () => ({ useTillMenu: () => ({ data: tillMenu.data }) }));

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
  setItemQuantitySpy,
  getOrderSpy,
  recordTenderSpy,
  voidOrderSpy,
} = vi.hoisted(() => ({
  voidOrderSpy: vi.fn(async () => ({ data: undefined, error: null })),
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
  setItemQuantitySpy: vi.fn(async () => ({ data: OPEN_ORDER, error: null })),
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
    printBill: printBillSpy,
    reprintKitchenTickets: reprintKitchenSpy,
    listOrderPage: listOrderPageSpy,
    removeItem: removeItemSpy,
    setItemQuantity: setItemQuantitySpy,
    voidOrder: voidOrderSpy,
  }),
}));

/** Print order, then Print in its preview (owner, 2026-10-21: every paper is shown before it prints). */
async function sendFromPreview() {
  await userEvent.click(screen.getByTestId("send-order"));
  await userEvent.click(await screen.findByTestId("paper-print"));
}

function renderNewOrder(props: Parameters<typeof NewOrder>[0] = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <NewOrder {...props} />
    </QueryClientProvider>,
  );
}

describe("NewOrder", () => {
  beforeEach(() => {
    tillMenu.data = undefined;
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

  it("One more raises the chosen line's quantity in Yetu, at the line's price; no new line", async () => {
    const line = await startOrder();
    addItemSpy.mockClear();
    await userEvent.click(line);
    await userEvent.click(ticket().getByRole("button", { name: "One more Nyama Choma" }));
    await waitFor(() => expect(setItemQuantitySpy).toHaveBeenCalledWith("order-1", "item-1", 2, 2, expect.any(String)));
    expect(addItemSpy).not.toHaveBeenCalled();
    // One is the least: Remove takes it off.
    expect(ticket().getByRole("button", { name: "One fewer Nyama Choma" })).toBeDisabled();
  });

  it("a refused change says why in words", async () => {
    setItemQuantitySpy.mockResolvedValueOnce({
      data: undefined,
      error: { status: 409, code: "ITEM_NOT_CHANGEABLE", title: "This item can no longer be changed.", detail: "Only an item not yet sent to the kitchen can be changed, and only before the order is paid." },
    } as never);
    await userEvent.click(await startOrder());
    await userEvent.click(ticket().getByRole("button", { name: "One more Nyama Choma" }));
    expect(await ticket().findByText("This item can't be changed now. If it hasn't gone to the kitchen, remove it and add it again.")).toBeInTheDocument();
  });

  it("Remove takes an unsent line off the order", async () => {
    await userEvent.click(await startOrder());
    await userEvent.click(ticket().getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeItemSpy).toHaveBeenCalledWith("order-1", "item-1", 2, expect.any(String)));
  });

  // F-260 (fbc-peak #286): the last line off, Yetu closes the order. The
  // ticket starts again with the same table; the next item is a new order,
  // never "This order is finished".
  it("taking off the last line starts the ticket again, at the same table", async () => {
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Nyama Choma");
    await waitFor(() => expect(tile).toBeEnabled());
    await userEvent.type(screen.getByRole("textbox", { name: "Table or name" }), "12");
    await userEvent.click(tile);
    await userEvent.click(await ticket().findByRole("button", { name: /Nyama Choma/ }));
    removeItemSpy.mockResolvedValueOnce({ data: { ...OPEN_ORDER, status: "VOIDED", items: [], version: 3 }, error: null });
    await userEvent.click(ticket().getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeItemSpy).toHaveBeenCalled());
    await waitFor(() => expect(ticket().queryByRole("button", { name: /Nyama Choma/ })).toBeNull());

    await userEvent.click(tile);
    await waitFor(() => expect(createOrderSpy).toHaveBeenCalledTimes(2));
    expect(createOrderSpy).toHaveBeenLastCalledWith(expect.objectContaining({ tableLabel: "12" }), expect.any(String));
    expect(screen.queryByText("This order is finished. Start a new sale.")).toBeNull();
  });

  it("sends no table for takeaway, even one typed for dine in first", async () => {
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Nyama Choma");
    await waitFor(() => expect(tile).toBeEnabled());
    await userEvent.type(screen.getByRole("textbox", { name: "Table or name" }), "12");
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

  it("Send and pay: a send Yetu refuses keeps the payment closed, and says why", async () => {
    await startOrder();
    sendOrderSpy.mockResolvedValueOnce({ data: undefined, error: { code: "FORBIDDEN", detail: "x" } } as never);
    await userEvent.click(screen.getByTestId("pay-order"));
    await userEvent.click(await screen.findByTestId("paper-print"));
    await waitFor(() => expect(sendOrderSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("amount-received")).toBeNull();
  });

  it("a cash drawer that didn't open is said on Sell once Paid is done", async () => {
    openDrawerSpy.mockResolvedValueOnce({ ok: false, error: "Printer offline" } as { ok: boolean });
    await startOrder();
    getOrderSpy.mockImplementation(async () => ({
      data: recordTenderSpy.mock.calls.length
        ? { ...OPEN_ORDER, status: "CLOSED" as const, paidMinor: 1200000, remainingMinor: 0, version: 3 }
        : OPEN_ORDER,
      error: null,
    }));
    await userEvent.click(screen.getByTestId("pay-order"));
    await userEvent.click(await screen.findByTestId("paper-print"));
    await userEvent.type(await screen.findByTestId("amount-received"), "15000");
    await userEvent.click(screen.getByTestId("confirm-settle"));
    const done = await screen.findByRole("dialog", { name: "Paid" });
    await userEvent.click(within(done).getByRole("button", { name: /New sale/ }));
    expect(await screen.findByText(/The cash drawer didn't open: printer offline/)).toBeInTheDocument();
  });

  // The owner, 2026-10-20: the guest gets the bill before paying (fbc-peak #288).
  // Every paper is shown before it prints: Back from the preview prints and sends nothing.
  it("Print order shows the papers first; Back sends nothing", async () => {
    await startOrder();
    await userEvent.click(screen.getByTestId("send-order"));
    const sheet = await screen.findByRole("dialog", { name: "Print order" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog", { name: "Print order" })).toBeNull();
    expect(sendOrderSpy).not.toHaveBeenCalled();
  });

  // Every paper: Pay with new items shows their papers first; Back neither sends nor pays.
  it("Pay with new items shows their papers first, and Back neither sends nor pays", async () => {
    await startOrder();
    await userEvent.click(screen.getByTestId("pay-order"));
    const sheet = await screen.findByRole("dialog", { name: "Print order" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Back" }));
    expect(sendOrderSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Take payment" })).toBeNull();
  });

  // A switch waits for the printer's answer, so a paper that didn't print is never lost (review, 2026-10-21).
  it("the open-orders bar holds while the order's papers are printing", async () => {
    let printed: (value: unknown[]) => void = () => undefined;
    printForSpy.mockImplementationOnce(() => new Promise((resolve) => (printed = resolve)));
    const other = { ...OPEN_ORDER, id: "order-2", orderNumber: "0002", dailyNumber: 2, tableLabel: "Window" };
    listOrderPageSpy.mockResolvedValue({ data: { items: [OPEN_ORDER, other], nextCursor: null }, error: null } as never);
    const socket = { readyState: 0, onopen: null, onmessage: null, onerror: null, onclose: null, binaryType: "blob",
      addEventListener: vi.fn(), removeEventListener: vi.fn(), send: vi.fn(), close: vi.fn() };
    const client = new RealtimeClient({ createSocket: () => socket as unknown as WebSocket, cursorStorage: { get: () => null, set: () => {} } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider client={client} queryClient={queryClient}>
          <NewOrder resume={OPEN_ORDER} onSwitch={vi.fn()} />
        </RealtimeProvider>
      </QueryClientProvider>,
    );
    const window = await screen.findByTestId("open-order-order-2");
    await waitFor(() => expect(screen.getByTestId("send-order")).toBeEnabled());
    await sendFromPreview();
    await waitFor(() => expect(printForSpy).toHaveBeenCalled());
    expect(window).toBeDisabled();
    await act(async () => printed([]));
    await waitFor(() => expect(window).toBeEnabled());
  });

  it("Print bill, beside Print order, prints the ticket's bill and says so", async () => {
    await startOrder();
    await userEvent.click(screen.getByRole("button", { name: /Print bill/ }));
    await userEvent.click(await screen.findByTestId("paper-print"));
    await waitFor(() => expect(printBillSpy).toHaveBeenCalledWith("order-1", expect.any(String)));
    await waitFor(() => expect(printJobNowSpy).toHaveBeenCalledWith(expect.objectContaining({ id: "bill-order-1", jobType: "BILL" })));
    expect(await screen.findByText("The bill for Order 1 was sent to the printer.")).toBeInTheDocument();
  });

  // With everything sent, Print order prints the last round again, marked COPY.
  it("Print order with nothing new prints the last papers again and says so", async () => {
    const sent = { ...OPEN_ORDER, status: "SENT" as const, roundsSent: 1, items: OPEN_ORDER.items.map((line) => ({ ...line, status: "SENT" as const, roundNumber: 1 })) };
    getOrderSpy.mockResolvedValue({ data: sent, error: null } as never);
    renderNewOrder({ resume: sent });
    const print = await screen.findByTestId("send-order");
    await waitFor(() => expect(print).toBeEnabled());
    await userEvent.click(print);
    await userEvent.click(await screen.findByTestId("paper-print"));
    await waitFor(() => expect(reprintKitchenSpy).toHaveBeenCalledWith(sent.id, expect.any(String), 1));
    expect(sendOrderSpy).not.toHaveBeenCalled();
    expect(await screen.findByText("The kitchen ticket went to the printer again, marked COPY.")).toBeInTheDocument();
  });

  // The owner, 2026-10-21: a waiter serving three customers works on three orders.
  it("shows the open orders above the ticket, and a tap moves Sell to another", async () => {
    const other = { ...OPEN_ORDER, id: "order-2", orderNumber: "0002", dailyNumber: 2, tableLabel: "Window" };
    listOrderPageSpy.mockResolvedValue({ data: { items: [OPEN_ORDER, other], nextCursor: null }, error: null } as never);
    const onSwitch = vi.fn();
    // The bar keeps up with orders as they change: Sell in the app sits inside live events.
    const socket = { readyState: 0, onopen: null, onmessage: null, onerror: null, onclose: null, binaryType: "blob",
      addEventListener: vi.fn(), removeEventListener: vi.fn(), send: vi.fn(), close: vi.fn() };
    const client = new RealtimeClient({ createSocket: () => socket as unknown as WebSocket, cursorStorage: { get: () => null, set: () => {} } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider client={client} queryClient={queryClient}>
          <NewOrder resume={OPEN_ORDER} onSwitch={onSwitch} />
        </RealtimeProvider>
      </QueryClientProvider>,
    );
    const bar = await screen.findByRole("navigation", { name: "Open orders" });
    await userEvent.click(await within(bar).findByRole("button", { name: /^Window/ }));
    expect(onSwitch).toHaveBeenCalledWith(expect.objectContaining({ id: "order-2" }));
    await userEvent.click(within(bar).getByTestId("open-orders-new"));
    expect(onSwitch).toHaveBeenLastCalledWith(null);
  });

  it("isn't in More for a person who can't send an order", async () => {
    setOperationalSession({
      ...getOperationalSession()!,
      permissions: ["pos.shift.open", "pos.order.create", "pos.order.item.add", "pos.payment.record"],
    });
    await startOrder();
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("button", { name: /Order note/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Print bill/ })).toBeNull();
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
    // Not sent yet: Pay sends it to the kitchen, then takes payment.
    await userEvent.click(screen.getByTestId("pay-order"));
    await userEvent.click(await screen.findByTestId("paper-print"));
    await userEvent.type(await screen.findByTestId("amount-received"), "15000");
    expect(sendOrderSpy).toHaveBeenCalledTimes(1);
    const printsBeforePayment = printForSpy.mock.calls.length;
    await userEvent.click(screen.getByTestId("confirm-settle"));
    const done = await screen.findByRole("dialog", { name: "Paid" });
    expect(within(done).getByTestId("done-change")).toHaveTextContent("Change to give TSh 3,000");
    // 2026-10-20: nothing prints after payment; the EFD gives the tax receipt, and the cashier is told to.
    expect(within(done).getByTestId("done-efd")).toHaveTextContent("Give the guest their EFD receipt.");
    expect(printForSpy.mock.calls.length).toBe(printsBeforePayment);
    // The cash drawer still opens for cash.
    expect(openDrawerSpy).toHaveBeenCalledTimes(1);
    expect(openDrawerSpy).toHaveBeenCalledWith("CASH");
    await userEvent.click(within(done).getByRole("button", { name: /New sale/ }));
    expect(screen.queryByRole("dialog", { name: "Paid" })).not.toBeInTheDocument();
    expect(ticket().getByText("Tap an item to start an order.")).toBeInTheDocument();
  });

  // F-232: reaching for View receipt as Paid went by itself rang up the tile beneath.
  it("a tap on the menu just as Paid goes by itself starts no order; a moment later it does", async () => {
    await startOrder();
    getOrderSpy.mockImplementation(async () => ({
      data: recordTenderSpy.mock.calls.length
        ? { ...OPEN_ORDER, status: "CLOSED" as const, paidMinor: 1200000, remainingMinor: 0, version: 3 }
        : OPEN_ORDER,
      error: null,
    }));
    await userEvent.click(screen.getByTestId("pay-order"));
    await userEvent.click(await screen.findByTestId("paper-print"));
    await userEvent.type(await screen.findByTestId("amount-received"), "15000");
    createOrderSpy.mockClear();
    // Paid's countdown runs on these clocks from the moment it opens.
    vi.useFakeTimers({ toFake: ["setInterval", "Date"] });
    try {
      fireEvent.click(screen.getByTestId("confirm-settle"));
      await screen.findByRole("dialog", { name: "Paid" });
      act(() => vi.advanceTimersByTime(REGISTER_AUTO_RETURN_SECONDS * 1000));
      expect(screen.queryByRole("dialog", { name: "Paid" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("menu-Tusker Lager"));
      // A tap's add starts on the next turn: give it that turn before looking.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(createOrderSpy).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(REGISTER_QUIET_AFTER_RETURN_MS));
      fireEvent.click(screen.getByTestId("menu-Tusker Lager"));
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(createOrderSpy).toHaveBeenCalledTimes(1));
  });

  it("Space presses a focused Send to kitchen and Pay", async () => {
    await startOrder();
    screen.getByTestId("send-order").focus();
    await userEvent.keyboard(" ");
    await userEvent.click(await screen.findByTestId("paper-print"));
    await waitFor(() => expect(sendOrderSpy).toHaveBeenCalled());
    const pay = screen.getByTestId("pay-order");
    await waitFor(() => expect(pay).toBeEnabled());
    pay.focus();
    await userEvent.keyboard(" ");
    // The send's answer here still has the items unsent (the stand-in Yetu keeps them): Pay shows their papers first.
    await userEvent.click(await screen.findByTestId("paper-print"));
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
      await sendFromPreview();
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
      await sendFromPreview();
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
      await sendFromPreview();
      await screen.findByRole("alert");
      await sendFromPreview();
      await waitFor(() => expect(sendOrderSpy).toHaveBeenCalledTimes(2));
      const [first, second] = sendOrderSpy.mock.calls as unknown as Array<[string, number, string]>;
      expect(second[2]).not.toBe(first[2]);
    });
  });
});

describe("NewOrder: the Restaurant & Bar module's menu (S16-B4)", () => {
  const NC = "00000000-0000-0000-0000-000000000001";
  const TL = "00000000-0000-0000-0000-000000000006";
  const sized = (pintAvailable = true) => ({
    enabled: true,
    groups: [{ id: "g-food", name: "Food", categoryIds: ["cat-1"] }],
    unplacedCategoryIds: [],
    sizes: {
      [TL]: [
        { id: "sz-bottle", name: "Bottle", priceMinor: 500000, isDefault: true, isAvailable: true },
        { id: "sz-pint", name: "Pint", priceMinor: 700000, isDefault: false, isAvailable: pintAvailable },
      ],
    },
    products: { [NC]: { tags: [{ label: "Halal", kind: "DIETARY" }] }, [TL]: { description: "Cold, from the tap or the bottle.", tags: [] } },
  });

  beforeEach(() => {
    localStorage.clear();
    setOperationalSession({
      token: "t",
      expiresAt: "2099-01-01T00:00:00Z",
      tenantId: "tenant-1",
      propertyId: "property-1",
      outletId: "outlet-1",
      staffId: "staff-1",
      terminalId: "terminal-1",
    } as never);
  });
  afterEach(() => {
    tillMenu.data = undefined;
    clearOperationalSession();
  });

  it("puts the groups first and says staff's tags on the tiles", async () => {
    tillMenu.data = sized();
    renderNewOrder();
    expect(await screen.findByRole("tab", { name: "Food" })).toBeInTheDocument();
    expect(await screen.findByTestId("menu-Nyama Choma")).toHaveTextContent("Halal");
    expect(screen.getByTestId("menu-Tusker Lager")).toHaveTextContent("TSh 5,000 · 2 sizes");
  });

  it("asks which size, and asks Yetu for that size (Yetu prices it)", async () => {
    tillMenu.data = sized();
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Tusker Lager");
    await waitFor(() => expect(tile).toBeEnabled());
    addItemSpy.mockClear();
    await userEvent.click(tile);
    const sheet = await screen.findByTestId("modifier-dialog");
    expect(within(sheet).getByTestId("options-description")).toHaveTextContent("Cold, from the tap or the bottle.");
    expect(within(sheet).getByTestId("size-option-sz-bottle")).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(sheet).getByTestId("size-option-sz-pint"));
    expect(within(sheet).getByTestId("modifier-confirm-add")).toHaveTextContent("Add to order · TSh 7,000");
    await userEvent.click(within(sheet).getByTestId("modifier-confirm-add"));
    await waitFor(() => expect(addItemSpy).toHaveBeenCalled());
    expect((addItemSpy.mock.calls[0] as unknown[])[1]).toEqual(expect.objectContaining({ productId: TL, variantId: "sz-pint", quantity: 1 }));
  });

  // F-231: sizes don't wait for the menu to be grouped.
  it("with menus off, still asks which size, and says staff's tags on the line", async () => {
    tillMenu.data = { ...sized(), enabled: false };
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Tusker Lager");
    await waitFor(() => expect(tile).toBeEnabled());
    addItemSpy.mockClear();
    await userEvent.click(tile);
    const sheet = await screen.findByTestId("modifier-dialog");
    await userEvent.click(within(sheet).getByTestId("size-option-sz-pint"));
    await userEvent.click(within(sheet).getByTestId("modifier-confirm-add"));
    await waitFor(() => expect(addItemSpy).toHaveBeenCalled());
    expect((addItemSpy.mock.calls[0] as unknown[])[1]).toEqual(expect.objectContaining({ productId: TL, variantId: "sz-pint" }));
  });

  it("says staff's tags on the order's line too, menus on or off (F-231)", async () => {
    for (const enabled of [true, false]) {
      cleanup();
      tillMenu.data = { ...sized(), enabled };
      renderNewOrder();
      const tile = await screen.findByTestId("menu-Nyama Choma");
      await waitFor(() => expect(tile).toBeEnabled());
      await userEvent.click(tile);
      expect(await within(screen.getByTestId("ticket-panel")).findByTestId("cart-Nyama Choma")).toHaveTextContent("Halal");
    }
  });

  it("won't take a size that is sold out today", async () => {
    tillMenu.data = sized(false);
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Tusker Lager");
    await waitFor(() => expect(tile).toBeEnabled());
    await userEvent.click(tile);
    const sheet = await screen.findByTestId("modifier-dialog");
    const pint = within(sheet).getByTestId("size-option-sz-pint");
    expect(pint).toHaveAttribute("aria-disabled", "true");
    expect(pint).toHaveTextContent("Sold out");
    await userEvent.click(pint);
    expect(pint).toHaveAttribute("aria-checked", "false");
  });
});

describe("NewOrder: rounds (S17a)", () => {
  beforeEach(() => {
    tillMenu.data = undefined;
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
      permissions: ["pos.shift.open", "pos.order.create", "pos.order.item.add", "pos.order.send", "pos.payment.record"],
    });
  });
  afterEach(() => clearOperationalSession());

  async function ringUp() {
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Nyama Choma");
    await waitFor(() => expect(tile).toBeEnabled());
    await userEvent.click(tile);
    await within(screen.getByTestId("ticket-panel")).findByRole("button", { name: /Nyama Choma/ });
  }

  it("takes more after a send from a Yetu with rounds, and says so for one without", async () => {
    const sentLines = OPEN_ORDER.items.map((item) => ({ ...item, status: "SENT" as const, roundNumber: 1 }));
    // Sell reads the order again after sending it: Yetu's sent order, with its round.
    getOrderSpy.mockResolvedValueOnce({ data: { ...OPEN_ORDER, status: "SENT", version: 3, roundsSent: 1, items: sentLines }, error: null } as never);
    await ringUp();
    await sendFromPreview();
    await waitFor(() => expect(sendOrderSpy).toHaveBeenCalled());
    // The order is Yetu's sent one now (its line says so), and the menu still takes more.
    expect(await within(screen.getByTestId("ticket-panel")).findByTestId("ticket-sent")).toBeInTheDocument();
    const tile = await screen.findByTestId("menu-Tusker Lager");
    await waitFor(() => expect(tile).toBeEnabled());
    expect(screen.queryByText("This order has gone to the kitchen. Start a new sale to add more.")).toBeNull();

    getOrderSpy.mockResolvedValueOnce({ data: { ...OPEN_ORDER, status: "SENT", version: 3, items: sentLines }, error: null } as never);
    cleanup();
    localStorage.clear();
    await ringUp();
    await sendFromPreview();
    expect(await screen.findByText("This order has gone to the kitchen. Start a new sale to add more.")).toBeInTheDocument();
  });
});

describe("NewOrder: carrying on with an order (F-236, F-230, F-241, F-243)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tillMenu.data = undefined;
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
      permissions: ["pos.shift.open", "pos.order.create", "pos.order.item.add", "pos.order.send", "pos.payment.record"],
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
    getOrderSpy.mockImplementation(async () => ({ data: OPEN_ORDER, error: null }));
    addItemSpy.mockImplementation(async () => ({ data: OPEN_ORDER, error: null }));
    printForSpy.mockImplementation(async () => []);
    clearOperationalSession();
  });

  // Table 4's order after its first round: sent, and taking more.
  const TABLE_4: POSOrder = {
    ...OPEN_ORDER,
    id: "order-4",
    dailyNumber: 4,
    status: "SENT",
    tableLabel: "4",
    version: 5,
    roundsSent: 1,
    items: OPEN_ORDER.items.map((item) => ({ ...item, status: "SENT" as const, roundNumber: 1 })),
  };

  it("carries on with an order brought back to Sell: its lines, its table, and the next tap adds to it", async () => {
    getOrderSpy.mockImplementation(async () => ({ data: TABLE_4, error: null }));
    addItemSpy.mockImplementation(async () => ({
      data: { ...TABLE_4, version: 6, items: [...TABLE_4.items, { ...OPEN_ORDER.items[0], id: "item-2", name: "Tusker Lager" }] },
      error: null,
    }));
    const onTicket = vi.fn();
    renderNewOrder({ resume: TABLE_4, onTicket });

    const ticket = within(screen.getByTestId("ticket-panel"));
    expect(await ticket.findByRole("button", { name: /Nyama Choma/ })).toBeInTheDocument();
    expect(screen.getByTestId("table-label")).toHaveTextContent("4");
    await waitFor(() => expect(getOrderSpy).toHaveBeenCalledWith("order-4"));

    const tile = await screen.findByTestId("menu-Tusker Lager");
    await waitFor(() => expect(tile).toBeEnabled());
    await userEvent.click(tile);
    await waitFor(() => expect(addItemSpy).toHaveBeenCalledTimes(1));
    expect(createOrderSpy).not.toHaveBeenCalled();
    expect(addItemSpy.mock.calls[0]).toEqual(expect.arrayContaining(["order-4"]));
    // The shell hears of the order on the ticket, so it is still there after a look at Orders.
    await waitFor(() => expect(onTicket).toHaveBeenLastCalledWith(expect.objectContaining({ id: "order-4", version: 6 })));
  });

  it("an order brought back that another till has paid starts an empty ticket, and says why", async () => {
    getOrderSpy.mockImplementation(async () => ({ data: { ...TABLE_4, status: "CLOSED", version: 9, remainingMinor: 0 }, error: null }));
    const onTicket = vi.fn();
    renderNewOrder({ resume: TABLE_4, onTicket });
    expect(await screen.findByText("Order 4 is paid already. Start a new sale.")).toBeInTheDocument();
    expect(within(screen.getByTestId("ticket-panel")).queryByRole("button", { name: /Nyama Choma/ })).toBeNull();
    // The words can show a moment before the empty ticket is reported (flaky 2 in 5 before 2026-10-20):
    // wait for it, then make sure it stays empty.
    await waitFor(() => expect(onTicket).toHaveBeenLastCalledWith(null));
    await act(async () => {});
    expect(onTicket).toHaveBeenLastCalledWith(null);
  });

  it("two quick taps on one beer are two beers, in turn, on one order", async () => {
    let version = 1;
    const lines: POSOrder["items"] = [];
    // The first beer is still with Yetu when the second tap comes.
    let answerFirst = () => {};
    const firstHeld = new Promise<void>((resolve) => (answerFirst = resolve));
    addItemSpy.mockImplementation(async () => {
      if (version === 1) await firstHeld;
      version += 1;
      lines.push({ ...OPEN_ORDER.items[0], id: `item-${version}`, name: "Tusker Lager" });
      return { data: { ...OPEN_ORDER, version, items: [...lines] }, error: null } as never;
    });
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Tusker Lager");
    await waitFor(() => expect(tile).toBeEnabled());
    fireEvent.click(tile);
    await waitFor(() => expect(addItemSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(tile);
    answerFirst();
    await waitFor(() => expect(addItemSpy).toHaveBeenCalledTimes(2));
    expect(createOrderSpy).toHaveBeenCalledTimes(1);
    // The second waited for the first, and was sent on the order as the first left it.
    const versions = addItemSpy.mock.calls.map((call) => (call as unknown[]).find((arg) => typeof arg === "object" && arg !== null && "version" in arg));
    expect(versions.map((body) => (body as { version: number }).version)).toEqual([1, 2]);
  });

  // F-247: on Bahari's till a tap showed nothing on the ticket for one or two
  // seconds while Yetu added the item, which invites a second tap.
  it("a tap shows on the ticket at once as being added, until Yetu's line takes its place", async () => {
    let answer = () => {};
    const held = new Promise<void>((resolve) => (answer = resolve));
    addItemSpy.mockImplementation(async () => {
      await held;
      return { data: { ...OPEN_ORDER, items: [{ ...OPEN_ORDER.items[0], id: "item-2", name: "Tusker Lager" }] }, error: null } as never;
    });
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Tusker Lager");
    await waitFor(() => expect(tile).toBeEnabled());
    fireEvent.click(tile);
    const ticket = within(screen.getByTestId("ticket-panel"));
    const waiting = await ticket.findByTestId("ticket-waiting");
    expect(waiting).toHaveTextContent("Tusker Lager");
    expect(waiting).toHaveTextContent("Adding…");
    expect(ticket.queryByText("Tap an item to start an order.")).toBeNull();
    answer();
    expect(await ticket.findByRole("button", { name: /Tusker Lager/ })).toBeInTheDocument();
    expect(ticket.queryByTestId("ticket-waiting")).toBeNull();
  });

  it("a tap Yetu refuses leaves no line being added behind, and says why", async () => {
    addItemSpy.mockImplementation(async () => ({
      data: null,
      error: { status: 409, code: "PRODUCT_UNAVAILABLE", detail: "That item is sold out or not on this outlet's menu." },
    }) as never);
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Tusker Lager");
    await waitFor(() => expect(tile).toBeEnabled());
    fireEvent.click(tile);
    const ticket = within(screen.getByTestId("ticket-panel"));
    expect(await ticket.findByRole("alert")).toHaveTextContent("sold out");
    expect(ticket.queryByTestId("ticket-waiting")).toBeNull();
  });

  it("Send and pay opens the payment as soon as the send is taken, while the ticket is still printing", async () => {
    printForSpy.mockImplementation(() => new Promise<unknown[]>(() => {}));
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Nyama Choma");
    await waitFor(() => expect(tile).toBeEnabled());
    await userEvent.click(tile);
    await within(screen.getByTestId("ticket-panel")).findByRole("button", { name: /Nyama Choma/ });
    await userEvent.click(screen.getByTestId("pay-order"));
    await userEvent.click(await screen.findByTestId("paper-print"));
    await waitFor(() => expect(sendOrderSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("amount-received")).toBeInTheDocument();
    expect(printForSpy).toHaveBeenCalled();
  });

  it("a void says the kitchen was told only of an order it had (F-243)", async () => {
    async function voidTheTicket(says: string) {
      await userEvent.click(screen.getByRole("button", { name: "More" }));
      await userEvent.click(await screen.findByRole("button", { name: /Cancel order/ }));
      const voiding = await screen.findByTestId("void-order-dialog");
      // Said before the approval too, not only after it.
      expect(voiding).toHaveTextContent(says);
      await giveReason("void-reason", "Wrong table", voiding);
      await userEvent.click(within(voiding).getByRole("radio", { name: /Grace Mushi/ }));
      for (const digit of "123456") await userEvent.click(within(voiding).getByTestId(`void-pin-key-${digit}`));
      await userEvent.click(within(voiding).getByTestId("confirm-void-order"));
      await waitFor(() => expect(voidOrderSpy).toHaveBeenCalled());
    }
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Nyama Choma");
    await waitFor(() => expect(tile).toBeEnabled());
    await userEvent.click(tile);
    await within(screen.getByTestId("ticket-panel")).findByRole("button", { name: /Nyama Choma/ });
    await voidTheTicket("Takes the whole order off. It never went to the kitchen.");
    expect(await screen.findByText("Order 1 was cancelled.")).toBeInTheDocument();

    cleanup();
    vi.clearAllMocks();
    renderNewOrder({ resume: TABLE_4 });
    await within(screen.getByTestId("ticket-panel")).findByRole("button", { name: /Nyama Choma/ });
    await voidTheTicket("Takes the whole order off and tells the kitchen.");
    expect(await screen.findByText("Order 4 was cancelled. The kitchen has been told.")).toBeInTheDocument();
  });

  // F-233: no printer, and the till said nothing.
  it("a kitchen ticket that didn't print is said on Sell", async () => {
    printForSpy.mockImplementation(async () => [{ ok: false, error: "No printer is set up on this till" }]);
    setOperationalSession({ ...getOperationalSession()!, token: "f233-session" });
    renderNewOrder();
    const tile = await screen.findByTestId("menu-Nyama Choma");
    await waitFor(() => expect(tile).toBeEnabled());
    await userEvent.click(tile);
    await within(screen.getByTestId("ticket-panel")).findByRole("button", { name: /Nyama Choma/ });
    await sendFromPreview();
    expect(
      await screen.findByText("The kitchen ticket didn't print: no printer is set up on this till. A manager sets up printers in Status (F12), under Printers."),
    ).toBeInTheDocument();
  });
});
