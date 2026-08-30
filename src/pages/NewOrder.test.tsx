import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewOrder } from "./NewOrder";
import { clearOperationalSession, setOperationalSession } from "../lib/operationalSession";
import type { POSCatalog } from "../lib/posContracts";

vi.mock("../lib/env", () => ({
  API_BASE_URL: "http://peak.test",
  getApiBaseUrl: () => "http://peak.test",
  REALTIME_BRIDGE_URL: "ws://localhost:5174/bridge",
  devIdentityFromEnv: () => ({ tenantId: "tenant-1", userId: "user-1", propertyId: "property-1", outletId: "outlet-1" }),
}));

const CATALOG: POSCatalog = {
  outletId: "outlet-1",
  outletName: "Mama Rose",
  categories: [],
  products: [
    { id: "00000000-0000-0000-0000-000000000001", code: "NC", name: "Nyama Choma", priceMinor: 1200000, currency: "TZS", taxRateBp: 1800 },
    { id: "00000000-0000-0000-0000-000000000006", code: "TL", name: "Tusker Lager", priceMinor: 500000, currency: "TZS", taxRateBp: 1800 },
  ],
};

const { getShiftSpy, openShiftSpy, closeShiftSpy, getCatalogSpy, createOrderSpy, addItemSpy } = vi.hoisted(() => ({
  getShiftSpy: vi.fn(async () => ({ data: { id: "shift-1", status: "OPEN", openingCashMinor: 0, expectedCashMinor: 0, businessDate: "2026-08-29", openedAt: "2026-08-29T08:00:00Z" }, error: null })),
  openShiftSpy: vi.fn(async () => ({ data: { id: "shift-1", status: "OPEN", openingCashMinor: 0, expectedCashMinor: 0, businessDate: "2026-08-29", openedAt: "2026-08-29T08:00:00Z" }, error: null })),
  closeShiftSpy: vi.fn(async () => ({ data: { id: "shift-1", status: "CLOSED", openingCashMinor: 0, expectedCashMinor: 0, businessDate: "2026-08-29", openedAt: "2026-08-29T08:00:00Z" }, error: null })),
  getCatalogSpy: vi.fn(async () => ({ data: CATALOG, error: null })),
  createOrderSpy: vi.fn(async () => ({ data: { id: "order-1", orderNumber: "POS-1", version: 1, shiftId: "shift-1", status: "OPEN", serviceType: "DINE_IN", subtotalMinor: 0, taxMinor: 0, totalMinor: 0, items: [] }, error: null })),
  addItemSpy: vi.fn(async (orderId: string) => ({
    data: { id: orderId, orderNumber: "POS-1", version: 2, shiftId: "shift-1", status: "OPEN", serviceType: "DINE_IN", subtotalMinor: 0, taxMinor: 0, totalMinor: 0, items: [] },
    error: null,
  })),
}));

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({
    getShift: getShiftSpy,
    openShift: openShiftSpy,
    closeShift: closeShiftSpy,
    getCatalog: getCatalogSpy,
    createOrder: createOrderSpy,
    addItem: addItemSpy,
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
    // A POS_CASHIER-equivalent grant so these order-composition tests are
    // not incidentally gated by the R6A-C permission signal; the dedicated
    // gating behavior is covered in TillControls.test.tsx.
    setOperationalSession({
      token: "t", expiresAt: "2099-01-01T00:00:00Z", tenantId: "tenant-1", propertyId: "property-1",
      outletId: "outlet-1", terminalId: "terminal-1", staffId: "staff-1", assurance: "RESTRICTED",
      capabilities: ["CORE", "POS"],
      permissions: ["pos.shift.open", "pos.shift.close", "pos.order.create", "pos.order.item.add", "pos.order.send", "pos.payment.record"],
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearOperationalSession();
  });

  it("opens a shift with the cashier's float and persists the opened id", async () => {
    renderNewOrder();
    await userEvent.type(screen.getByTestId("opening-float"), "0");
    await userEvent.click(await screen.findByTestId("open-shift"));
    await waitFor(() => expect(openShiftSpy).toHaveBeenCalledWith(0, expect.any(String)));
    expect(await screen.findByTestId("shift-open")).toBeInTheDocument();
    expect(localStorage.getItem("peak-pos-shift-property-1-outlet-1")).toBe("shift-1");
  });

  it("reuses a stored open shift and closes it on demand", async () => {
    localStorage.setItem("peak-pos-shift-property-1-outlet-1", "shift-1");
    renderNewOrder();
    await waitFor(() => expect(getShiftSpy).toHaveBeenCalledWith("shift-1"));
    expect(await screen.findByTestId("shift-open")).toBeInTheDocument();

    await userEvent.type(screen.getByTestId("counted-cash"), "0");
    await userEvent.click(screen.getByTestId("close-shift"));
    await waitFor(() => expect(closeShiftSpy).toHaveBeenCalledWith("shift-1", { countedCashMinor: 0, supervisorStaffId: undefined, supervisorPin: undefined }, expect.any(String)));
  });

  it("composes an order from the real catalog: menu taps build a cart, create issues create+add commands with version chaining", async () => {
    localStorage.setItem("peak-pos-shift-property-1-outlet-1", "shift-1");
    renderNewOrder();
    await screen.findByTestId("shift-open");

    await userEvent.click(await screen.findByTestId("menu-Nyama Choma"));
    await userEvent.click(screen.getByTestId("menu-Nyama Choma"));
    await userEvent.click(screen.getByTestId("menu-Tusker Lager"));
    expect(screen.getByTestId("cart-Nyama Choma")).toHaveTextContent("2");

    await userEvent.type(screen.getByTestId("table-label"), "T12");
    await userEvent.click(screen.getByTestId("create-order"));

    await waitFor(() => expect(createOrderSpy).toHaveBeenCalledWith({ shiftId: "shift-1", serviceType: "DINE_IN", tableLabel: "T12", notes: undefined }, expect.any(String)));
    await waitFor(() => expect(addItemSpy).toHaveBeenCalledTimes(2));
    expect(addItemSpy).toHaveBeenNthCalledWith(
      1,
      "order-1",
      expect.objectContaining({ quantity: 2, productId: "00000000-0000-0000-0000-000000000001", version: 1 }),
      expect.any(String),
    );
    expect(addItemSpy).toHaveBeenNthCalledWith(
      2,
      "order-1",
      expect.objectContaining({ quantity: 1, productId: "00000000-0000-0000-0000-000000000006", version: 2 }),
      expect.any(String),
    );
    expect(await screen.findByTestId("order-created")).toHaveTextContent("POS-1");
    expect(screen.queryByTestId("cart-Nyama Choma")).not.toBeInTheDocument();
  });

  it("blocks order entry without an open shift", async () => {
    renderNewOrder();
    await screen.findByTestId("open-shift");
    expect(screen.queryByTestId("create-order")).not.toBeInTheDocument();
  });
});
