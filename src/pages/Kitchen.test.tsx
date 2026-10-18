import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RealtimeClient } from "../realtime/RealtimeClient";
import { RealtimeProvider } from "../realtime/RealtimeProvider";
import { Kitchen } from "./Kitchen";
import { idleLockHeld } from "../lib/idleLock";
import { clearOperationalSession, setOperationalSession } from "../lib/operationalSession";
import type { POSOrder, POSStationTicket } from "../lib/posContracts";

vi.mock("../lib/env", () => ({
  devIdentityFromEnv: () => ({ tenantId: "tenant-1", userId: "user-1", propertyId: "property-1", outletId: "outlet-1" }),
}));

const ordersStore = new Map<string, POSOrder>();
const ticketsStore = new Map<string, POSStationTicket>();

type Result = { data?: unknown; error?: unknown };
const { listOrdersSpy, transitionStatusSpy, getOrderSpy, listStationTicketsSpy, transitionStationTicketSpy, identity } = vi.hoisted(() => ({
  listOrdersSpy: vi.fn(async (): Promise<Result> => ({ data: { items: Array.from(ordersStore.values()), nextCursor: null }, error: null })),
  transitionStatusSpy: vi.fn(async (..._args: unknown[]): Promise<Result> => ({ data: undefined, error: null })),
  getOrderSpy: vi.fn(async (orderId: string): Promise<Result> => ({ data: ordersStore.get(orderId), error: null })),
  listStationTicketsSpy: vi.fn(async (): Promise<Result> => ({ data: { items: Array.from(ticketsStore.values()) }, error: null })),
  transitionStationTicketSpy: vi.fn(async (..._args: unknown[]): Promise<Result> => ({ data: undefined, error: null })),
  identity: { current: { mode: "POS", terminalName: "Front till", prepStations: [] as string[] } },
}));

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({
    listOrderPage: listOrdersSpy,
    transitionStatus: transitionStatusSpy,
    getOrder: getOrderSpy,
    listStationTickets: listStationTicketsSpy,
    transitionStationTicket: transitionStationTicketSpy,
  }),
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSession: () => ({ identity: identity.current, phase: "ready", switchStaff: vi.fn() }),
}));

class FakeSocket {
  binaryType = "blob";
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  send(data: string | ArrayBuffer): void {
    this.sent.push(String(data));
  }
  close(): void {}
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(body: string): void {
    this.onmessage?.({ data: body });
  }
}

function announce(sequenceId: number, type: string, orderId: string): string {
  return JSON.stringify({
    sequence_id: sequenceId,
    id: `evt-${sequenceId}`,
    type,
    version: 1,
    resource_type: "POS_ORDER",
    resource_id: orderId,
    occurred_at: new Date().toISOString(),
    organization_id: "tenant-1",
    property_id: "property-1",
    data: { outletId: "outlet-1" },
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function renderKitchen() {
  const socket = new FakeSocket();
  const client = new RealtimeClient({ createSocket: () => socket as unknown as WebSocket, cursorStorage: { get: () => null, set: () => {} } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider client={client} queryClient={queryClient}>
        <Kitchen />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  return socket;
}

function signIn(permissions: string[] = ["pos.order.read", "pos.order.send"]) {
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
    permissions,
  });
}

const SENT_AT = new Date(Date.now() - 4 * 60_000).toISOString();

const SENT_ORDER: POSOrder = {
  id: "order-1",
  shiftId: "shift-1",
  orderNumber: "K-12",
  dailyNumber: 12,
  createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  closedAt: null,
  payments: [],
  status: "SENT",
  serviceType: "DINE_IN",
  tableLabel: "T4",
  initiatedById: "staff-1",
  initiatedByName: "Amina Hassan",
  subtotalMinor: 1000,
  discountMinor: 0,
  discountKind: "NONE",
  discountInput: 0,
  taxMinor: 180,
  totalMinor: 1180,
  paidMinor: 0,
  remainingMinor: 1180,
  version: 2,
  items: [{ id: "line-1", productId: "p1", name: "Nyama Choma", quantity: 2, unitPriceMinor: 500, taxMinor: 90, totalMinor: 1180, status: "SENT" }],
};

function stationTicket(id: string, station: POSStationTicket["station"], extra: Partial<POSStationTicket> = {}): POSStationTicket {
  return {
    id,
    orderId: "order-1",
    orderNumber: "K-12",
    dailyNumber: 12,
    station,
    status: "SENT",
    serviceType: "DINE_IN",
    tableLabel: "T4",
    waiterName: "Amina Hassan",
    version: 1,
    createdAt: SENT_AT,
    lastStepAt: SENT_AT,
    items: SENT_ORDER.items,
    ...extra,
  };
}

const refused = (problem: Record<string, unknown>): Result => ({ data: undefined, error: problem });

describe("Kitchen on a selling till (whole orders)", () => {
  beforeEach(() => {
    identity.current = { mode: "POS", terminalName: "Front till", prepStations: [] };
    signIn();
  });

  afterEach(() => {
    ordersStore.clear();
    ticketsStore.clear();
    vi.clearAllMocks();
    clearOperationalSession();
  });

  it("subscribes to the outlet and refetches when an order is sent", async () => {
    const socket = renderKitchen();
    expect(await screen.findByText("No orders waiting")).toBeInTheDocument();

    ordersStore.set("order-1", SENT_ORDER);
    socket.open();
    await flush();
    socket.emit(announce(1, "pos.order.sent", "order-1"));
    const card = await screen.findByTestId("kitchen-ticket-order-1");
    expect(card).toHaveTextContent("Table T4 · Amina Hassan");
    await waitFor(() => expect(listOrdersSpy.mock.calls.length).toBeGreaterThan(1));
  });

  it("follows a kitchen display: when a station ticket moves, the orders reload at once", async () => {
    ordersStore.set("order-1", SENT_ORDER);
    ticketsStore.set("t-1", stationTicket("t-1", "GENERAL"));
    const socket = renderKitchen();
    await screen.findByTestId("kitchen-ticket-order-1");
    socket.open();
    await flush();
    ordersStore.set("order-1", { ...SENT_ORDER, status: "PREPARING", version: 3 });
    ticketsStore.set("t-1", stationTicket("t-1", "GENERAL", { status: "PREPARING", version: 2 }));
    socket.emit(announce(7, "pos.station_ticket.status_changed", "order-1"));
    await waitFor(() => expect(screen.getByTestId("kitchen-column-PREPARING")).toContainElement(screen.getByTestId("kitchen-ticket-order-1")));
  });

  it("takes the time sent from Yetu's station ticket for the order, not from when this screen saw it", async () => {
    ordersStore.set("order-1", SENT_ORDER);
    ticketsStore.set("t-1", stationTicket("t-1", "GENERAL"));
    renderKitchen();
    expect(await screen.findByTestId("kitchen-age-order-1")).toHaveTextContent("On time · 4 min");
  });

  it("starts a sent order with its current version, and says so", async () => {
    ordersStore.set("order-1", SENT_ORDER);
    renderKitchen();
    await userEvent.click(await screen.findByTestId("kitchen-next-order-1"));
    await waitFor(() => expect(transitionStatusSpy).toHaveBeenCalledWith("order-1", "PREPARING", 2, expect.any(String)));
    expect(transitionStationTicketSpy).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Order 12 started.");
  });

  it("asks again with the same key after a lost answer, and with a new key for the next step", async () => {
    ordersStore.set("order-1", SENT_ORDER);
    transitionStatusSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderKitchen();
    await userEvent.click(await screen.findByTestId("kitchen-next-order-1"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach Yetu. Check the internet connection, then try again.");
    await waitFor(() => expect(screen.getByTestId("kitchen-next-order-1")).not.toHaveAttribute("aria-disabled"));

    // This time Yetu takes it: the order is Preparing at version 3.
    ordersStore.set("order-1", { ...SENT_ORDER, status: "PREPARING", version: 3 });
    await userEvent.click(screen.getByTestId("kitchen-next-order-1"));
    await waitFor(() => expect(transitionStatusSpy).toHaveBeenCalledTimes(2));
    const [first, second] = transitionStatusSpy.mock.calls;
    expect(second.slice(0, 3)).toEqual(["order-1", "PREPARING", 2]);
    expect(second[3]).toBe(first[3]);

    await waitFor(() => expect(screen.getByTestId("kitchen-next-order-1")).toHaveTextContent("Ready"));
    await userEvent.click(screen.getByTestId("kitchen-next-order-1"));
    await waitFor(() => expect(transitionStatusSpy).toHaveBeenCalledTimes(3));
    const third = transitionStatusSpy.mock.calls[2];
    expect(third.slice(0, 3)).toEqual(["order-1", "READY", 3]);
    expect(third[3]).not.toBe(first[3]);
  });

  it("sends a step once however often it is pressed, until Yetu's fresh list shows it moved", async () => {
    ordersStore.set("order-1", SENT_ORDER);
    let answer: (value: Result) => void = () => undefined;
    transitionStatusSpy.mockImplementationOnce(() => new Promise<Result>((resolve) => (answer = resolve)));
    const socket = renderKitchen();
    const step = await screen.findByTestId("kitchen-next-order-1");
    await userEvent.click(step);
    await userEvent.click(step);
    expect(step).toHaveAttribute("aria-disabled", "true");
    expect(step).toHaveTextContent("Starting…");
    expect(idleLockHeld()).toBe(true);

    // Yetu took it, but the list it sends next was read before the step: still held.
    await act(async () => answer({ data: undefined, error: null }));
    expect(idleLockHeld()).toBe(false);
    await waitFor(() => expect(listOrdersSpy.mock.calls.length).toBeGreaterThan(1));
    await flush();
    expect(screen.getByTestId("kitchen-next-order-1")).toHaveAttribute("aria-disabled", "true");
    expect(transitionStatusSpy).toHaveBeenCalledTimes(1);

    // The next list shows it Preparing: its next step is open.
    ordersStore.set("order-1", { ...SENT_ORDER, status: "PREPARING", version: 3 });
    socket.open();
    await flush();
    socket.emit(announce(1, "pos.order.preparing", "order-1"));
    await waitFor(() => expect(screen.getByTestId("kitchen-next-order-1")).toHaveTextContent("Ready"));
    expect(screen.getByTestId("kitchen-next-order-1")).not.toHaveAttribute("aria-disabled");
  });

  it("keeps a step held while it is with Yetu, even if the list changes meanwhile, and lets it go once Yetu answers", async () => {
    ordersStore.set("order-1", SENT_ORDER);
    let answer: (value: Result) => void = () => undefined;
    transitionStatusSpy.mockImplementationOnce(() => new Promise<Result>((resolve) => (answer = resolve)));
    const socket = renderKitchen();
    await userEvent.click(await screen.findByTestId("kitchen-next-order-1"));
    ordersStore.set("order-1", { ...SENT_ORDER, status: "PREPARING", version: 3 });
    socket.open();
    await flush();
    socket.emit(announce(1, "pos.order.preparing", "order-1"));
    await waitFor(() => expect(screen.getByTestId("kitchen-next-order-1")).toHaveTextContent("Marking ready…"));
    expect(screen.getByTestId("kitchen-next-order-1")).toHaveAttribute("aria-disabled", "true");

    // Yetu answers after its list already showed the move: the list it sends next says
    // nothing new, yet the step is let go.
    await act(async () => answer({ data: undefined, error: null }));
    await waitFor(() => expect(screen.getByTestId("kitchen-next-order-1")).toHaveTextContent("Ready"));
    expect(screen.getByTestId("kitchen-next-order-1")).not.toHaveAttribute("aria-disabled");
  });

  it("takes a wrong-step refusal (a 500 today) to mean the order moved: reloads, says so, and the next press is a new request", async () => {
    ordersStore.set("order-1", SENT_ORDER);
    transitionStatusSpy.mockResolvedValueOnce(refused({ code: "INTERNAL_ERROR", detail: "order is not in the required prior state" }));
    renderKitchen();
    await userEvent.click(await screen.findByTestId("kitchen-next-order-1"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This ticket was moved on another screen. The board shows where it is now.");
    expect(screen.getByRole("alert")).not.toHaveTextContent(/Peak|went wrong/);
    await waitFor(() => expect(listOrdersSpy.mock.calls.length).toBeGreaterThan(1));
    await userEvent.click(screen.getByTestId("kitchen-next-order-1"));
    await waitFor(() => expect(transitionStatusSpy).toHaveBeenCalledTimes(2));
    expect(transitionStatusSpy.mock.calls[1][3]).not.toBe(transitionStatusSpy.mock.calls[0][3]);
  });

  it("says why Yetu refused, as an alert, and lets the person try again", async () => {
    ordersStore.set("order-1", SENT_ORDER);
    transitionStatusSpy.mockResolvedValueOnce(refused({ code: "FORBIDDEN" }));
    renderKitchen();
    await userEvent.click(await screen.findByTestId("kitchen-next-order-1"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This ticket can't be moved from here. Your role or this screen's kitchen stations don't allow it. Ask a manager.",
    );
    expect(screen.getByTestId("kitchen-next-order-1")).not.toHaveAttribute("aria-disabled");
    // A refused request is never sent again under its key.
    await userEvent.click(screen.getByTestId("kitchen-next-order-1"));
    await waitFor(() => expect(transitionStatusSpy).toHaveBeenCalledTimes(2));
    expect(transitionStatusSpy.mock.calls[1][3]).not.toBe(transitionStatusSpy.mock.calls[0][3]);
  });

  it("shows the step closed, with who can, to a person without pos.order.send", async () => {
    signIn(["pos.order.read"]);
    ordersStore.set("order-1", SENT_ORDER);
    renderKitchen();
    expect(await screen.findByTestId("kitchen-next-order-1")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("note")).toHaveTextContent("Only kitchen and waiting staff can move tickets on.");
    await userEvent.click(screen.getByTestId("kitchen-next-order-1"));
    expect(transitionStatusSpy).not.toHaveBeenCalled();
  });
});

describe("Kitchen on a kitchen or bar display (station tickets)", () => {
  beforeEach(() => {
    signIn();
  });

  afterEach(() => {
    ordersStore.clear();
    ticketsStore.clear();
    vi.clearAllMocks();
    clearOperationalSession();
  });

  it("moves its own station's ticket, never the whole order", async () => {
    identity.current = { mode: "KITCHEN_DISPLAY", terminalName: "Grill screen", prepStations: ["GRILL"] };
    ticketsStore.set("t-1", stationTicket("t-1", "GRILL"));
    renderKitchen();
    expect(await screen.findByRole("heading", { level: 1, name: "Kitchen" })).toBeInTheDocument();
    expect(screen.getByText("Grill")).toBeInTheDocument();
    await userEvent.click(await screen.findByTestId("kitchen-next-t-1"));
    await waitFor(() => expect(transitionStationTicketSpy).toHaveBeenCalledWith("t-1", "PREPARING", 1, expect.any(String)));
    expect(transitionStatusSpy).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Order 12 (Grill) started.");
  });

  it("reloads the tickets when another screen moved one first", async () => {
    identity.current = { mode: "KITCHEN_DISPLAY", terminalName: "Grill screen", prepStations: [] };
    ticketsStore.set("t-1", stationTicket("t-1", "GRILL"));
    transitionStationTicketSpy.mockResolvedValueOnce(refused({ code: "STALE_VERSION" }));
    renderKitchen();
    await userEvent.click(await screen.findByTestId("kitchen-next-t-1"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This ticket was moved on another screen. The board shows where it is now.");
    await waitFor(() => expect(listStationTicketsSpy.mock.calls.length).toBeGreaterThan(1));
  });

  it("is the Bar on a bar display", async () => {
    identity.current = { mode: "BAR_DISPLAY", terminalName: "Bar", prepStations: [] };
    renderKitchen();
    expect(await screen.findByRole("heading", { level: 1, name: "Bar" })).toBeInTheDocument();
  });

  it("shows one of the screen's stations at a time when it shows more than one", async () => {
    identity.current = { mode: "KITCHEN_DISPLAY", terminalName: "Hot pass", prepStations: ["GRILL", "BAR"] };
    ticketsStore.set("t-1", stationTicket("t-1", "GRILL"));
    ticketsStore.set("t-2", stationTicket("t-2", "BAR"));
    renderKitchen();
    await screen.findByTestId("kitchen-ticket-t-2");
    expect(within(screen.getByTestId("kitchen-column-SENT")).getAllByRole("article")).toHaveLength(2);
    await userEvent.click(screen.getByRole("radio", { name: "Grill" }));
    expect(within(screen.getByTestId("kitchen-column-SENT")).getAllByRole("article").map((card) => card.dataset.testid)).toEqual([
      "kitchen-ticket-t-1",
    ]);
  });
});
