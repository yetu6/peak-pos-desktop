import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    },
    {
      id: "00000000-0000-0000-0000-000000000006",
      categoryId: "cat-1",
      code: "TL",
      name: "Tusker Lager",
      priceMinor: 500000,
      currency: "TZS",
      taxRateBp: 1800,
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
  subtotalMinor: 1016949,
  taxMinor: 183051,
  totalMinor: 1200000,
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
      subtotalMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
      items: [],
    },
    error: null,
  })),
  addItemSpy: vi.fn(async () => ({ data: OPEN_ORDER, error: null })),
  sendOrderSpy: vi.fn(async () => ({ data: { ...OPEN_ORDER, status: "SENT", version: 3 }, error: null })),
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
    removeItem: vi.fn(async () => ({ data: { ...OPEN_ORDER, items: [], version: 3 }, error: null })),
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

  it("resumes the server current shift and closes it on demand", async () => {
    renderNewOrder();
    await waitFor(() => expect(getCurrentShiftSpy).toHaveBeenCalled());
    expect(await screen.findByTestId("shift-open")).toBeInTheDocument();

    await userEvent.type(screen.getByTestId("counted-cash"), "0");
    await userEvent.click(screen.getByTestId("close-shift"));
    await waitFor(() =>
      expect(closeShiftSpy).toHaveBeenCalledWith(
        "shift-1",
        { countedCashMinor: 0, supervisorStaffId: undefined, supervisorPin: undefined },
        expect.any(String),
      ),
    );
  });

  it("builds a live ticket through createOrder and addItem", async () => {
    renderNewOrder();
    await screen.findByTestId("shift-open");

    const productTile = await screen.findByTestId("menu-Nyama Choma");
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
});
