import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewOrder } from "./NewOrder";

vi.mock("../lib/env", () => ({
  devIdentityFromEnv: () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    propertyId: "property-1",
    outletId: "outlet-1",
  }),
}));

const {
  getSessionSpy,
  openSessionSpy,
  closeSessionSpy,
  createOrderSpy,
  addItemSpy,
} = vi.hoisted(() => ({
  getSessionSpy: vi.fn(async () => ({
    data: { session: { id: "session-1", status: "open" } },
    error: null,
  })),
  openSessionSpy: vi.fn(async () => ({
    data: { id: "session-1", status: "open" },
    error: null,
  })),
  closeSessionSpy: vi.fn(async () => ({ data: {}, error: null })),
  createOrderSpy: vi.fn(async () => ({
    data: { id: "order-1", orderNumber: "POS-1" },
    error: null,
  })),
  addItemSpy: vi.fn(async () => ({
    data: { id: "order-1", orderNumber: "POS-1" },
    error: null,
  })),
}));

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({
    getSession: getSessionSpy,
    openSession: openSessionSpy,
    closeSession: closeSessionSpy,
    createOrder: createOrderSpy,
    addItem: addItemSpy,
  }),
}));

function renderNewOrder() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NewOrder />
    </QueryClientProvider>,
  );
}

describe("NewOrder", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("opens a session when none is stored and persists the opened id", async () => {
    renderNewOrder();
    const openButton = await screen.findByTestId("open-session");
    await userEvent.click(openButton);

    await waitFor(() =>
      expect(openSessionSpy).toHaveBeenCalledWith("property-1", "outlet-1", 0),
    );
    expect(await screen.findByTestId("session-open")).toBeInTheDocument();
    expect(localStorage.getItem("peak-pos-session-property-1-outlet-1")).toBe(
      "session-1",
    );
  });

  it("reuses a stored session that is still open and closes it on demand", async () => {
    localStorage.setItem("peak-pos-session-property-1-outlet-1", "session-1");
    renderNewOrder();
    await waitFor(() =>
      expect(getSessionSpy).toHaveBeenCalledWith("property-1", "session-1"),
    );
    expect(await screen.findByTestId("session-open")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("close-session"));
    await waitFor(() =>
      expect(closeSessionSpy).toHaveBeenCalledWith("property-1", "session-1", undefined),
    );
    expect(localStorage.getItem("peak-pos-session-property-1-outlet-1")).toBeNull();
  });

  it("composes an order: menu taps build a cart, create issues create+add commands", async () => {
    localStorage.setItem("peak-pos-session-property-1-outlet-1", "session-1");
    renderNewOrder();
    await screen.findByTestId("session-open");

    await userEvent.click(screen.getByTestId("menu-Nyama Choma"));
    await userEvent.click(screen.getByTestId("menu-Nyama Choma"));
    await userEvent.click(screen.getByTestId("menu-Tusker Lager"));
    expect(screen.getByTestId("cart-Nyama Choma")).toHaveTextContent("2");

    await userEvent.type(screen.getByTestId("table-number"), "T12");
    await userEvent.click(screen.getByTestId("create-order"));

    await waitFor(() =>
      expect(createOrderSpy).toHaveBeenCalledWith("property-1", {
        sessionId: "session-1",
        orderType: "dine_in",
        tableNumber: "T12",
      }),
    );
    await waitFor(() => expect(addItemSpy).toHaveBeenCalledTimes(2));
    expect(addItemSpy).toHaveBeenNthCalledWith(
      1,
      "property-1",
      "order-1",
      expect.objectContaining({
        quantity: 2,
        menuItemId: "00000000-0000-0000-0000-000000000001",
      }),
    );
    expect(addItemSpy).toHaveBeenNthCalledWith(
      2,
      "property-1",
      "order-1",
      expect.objectContaining({
        quantity: 1,
        menuItemId: "00000000-0000-0000-0000-000000000006",
      }),
    );
    expect(await screen.findByTestId("order-created")).toHaveTextContent("POS-1");
    expect(screen.queryByTestId("cart-Nyama Choma")).not.toBeInTheDocument();
  });

  it("blocks creation without a session", async () => {
    renderNewOrder();
    await screen.findByTestId("open-session");
    expect(screen.queryByTestId("create-order")).not.toBeInTheDocument();
  });
});