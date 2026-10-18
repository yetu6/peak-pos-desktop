import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { POSOrder, POSOrderPage } from "../lib/posContracts";
import { RealtimeClient } from "../realtime/RealtimeClient";
import { RealtimeProvider } from "../realtime/RealtimeProvider";
import { PAID_ORDERS } from "../visual/ordersData";
import { PAID_LIST_REFRESH_SECONDS, PAID_SEARCH_MOST_PAGES } from "./ordersSettings";
import { usePaidOrders } from "./usePaidOrders";

vi.mock("../lib/env", () => ({
  devIdentityFromEnv: () => ({ tenantId: "tenant-1", userId: "user-1", propertyId: "property-1", outletId: "outlet-1" }),
}));

type PageQuery = { view: "open" | "paid"; businessDate?: string; cursor?: string };
const { listOrderPage } = vi.hoisted(() => ({
  listOrderPage: vi.fn(async (_query: PageQuery) => ({ data: { items: [], nextCursor: null } as POSOrderPage, error: null as unknown })),
}));

vi.mock("../lib/posApi", () => ({ createPosApi: () => ({ listOrderPage }) }));

/** Yetu's paid view of one business day, latest paid first, in pages (fbc-peak orders_list.go). */
function paidDay(total: number, pageSize: number) {
  const orders: POSOrder[] = Array.from({ length: total }, (_, index) => ({
    ...PAID_ORDERS[0],
    id: `paid-${index + 1}`,
    dailyNumber: total - index,
    orderNumber: `POS-MR-261012-${total - index}`,
  }));
  listOrderPage.mockImplementation(async ({ cursor }: PageQuery) => {
    const start = cursor ? Number(cursor) : 0;
    const next = start + pageSize < total ? String(start + pageSize) : null;
    return { data: { items: orders.slice(start, start + pageSize), nextCursor: next, businessDate: "2026-10-12" }, error: null };
  });
  return orders;
}

const SHIFT = { id: "shift-1", businessDate: "2026-10-12" };

class FakeSocket {
  binaryType = "blob";
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  send(): void {}
  close(): void {}
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(sequence: number, type: string): void {
    this.onmessage?.({
      data: JSON.stringify({
        sequence_id: sequence,
        id: `evt-${sequence}`,
        type,
        version: 1,
        resource_type: "pos_order",
        resource_id: `order-${sequence}`,
        occurred_at: new Date().toISOString(),
        organization_id: "tenant-1",
        property_id: "property-1",
        data: { outletId: "outlet-1" },
      }),
    });
  }
}

function Probe({ enabled, searching = false }: { enabled: boolean; searching?: boolean }) {
  const paid = usePaidOrders(SHIFT, enabled, searching);
  return (
    <>
      <p data-testid="probe">{paid.isSuccess ? "loaded" : "waiting"}</p>
      <p data-testid="count">{paid.orders?.length ?? "none"}</p>
      <p data-testid="more">{paid.hasMore ? "more" : "all"}</p>
      <p data-testid="searched">{paid.searchedAll ? "searched all" : "searched some"}</p>
      <button type="button" onClick={paid.loadMore}>
        Show more
      </button>
    </>
  );
}

async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function renderProbe(enabled = true, searching = false) {
  const socket = new FakeSocket();
  const client = new RealtimeClient({ createSocket: () => socket as unknown as WebSocket, cursorStorage: { get: () => null, set: () => {} } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider client={client} queryClient={queryClient}>
        <Probe enabled={enabled} searching={searching} />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  return { socket, view, queryClient, client };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  listOrderPage.mockReset();
  paidDay(0, 50);
});

afterEach(() => vi.useRealTimers());

describe("usePaidOrders: Yetu's paid view of the shift's business day (S5b)", () => {
  it("asks for the shift's business day, one page, and says more are there", async () => {
    paidDay(120, 50);
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("50"));
    expect(listOrderPage).toHaveBeenCalledTimes(1);
    expect(listOrderPage).toHaveBeenLastCalledWith({ view: "paid", businessDate: "2026-10-12" });
    expect(screen.getByTestId("more")).toHaveTextContent("more");
  });

  it("Show more asks for the next page with Yetu's cursor, past the old 50-order cut", async () => {
    paidDay(120, 50);
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("50"));
    await act(async () => screen.getByRole("button", { name: "Show more" }).click());
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("100"));
    expect(listOrderPage).toHaveBeenLastCalledWith({ view: "paid", businessDate: "2026-10-12", cursor: "50" });
    await act(async () => screen.getByRole("button", { name: "Show more" }).click());
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("120"));
    expect(screen.getByTestId("more")).toHaveTextContent("all");
  });

  it("a search reads the rest of the day, so 'no match' is never said of orders not yet read", async () => {
    paidDay(180, 50);
    renderProbe(true, true);
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("180"));
    expect(listOrderPage).toHaveBeenCalledTimes(4);
    expect(screen.getByTestId("searched")).toHaveTextContent("searched all");
  });

  it("a search stops at its ceiling of pages and says it didn't read them all", async () => {
    paidDay(50 * (PAID_SEARCH_MOST_PAGES + 3), 50);
    renderProbe(true, true);
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent(String(50 * PAID_SEARCH_MOST_PAGES)));
    await flush();
    expect(listOrderPage).toHaveBeenCalledTimes(PAID_SEARCH_MOST_PAGES);
    expect(screen.getByTestId("searched")).toHaveTextContent("searched some");
  });
});

describe("usePaidOrders", () => {
  it("is the named setting: 30 seconds", () => {
    expect(PAID_LIST_REFRESH_SECONDS).toBe(30);
  });

  it("asks Yetu only when the Paid tab is open", async () => {
    renderProbe(false);
    await flush();
    expect(listOrderPage).not.toHaveBeenCalled();
  });

  it("a payment at the outlet marks the list out of date; it is asked for again on the next refresh, once", async () => {
    const { socket } = renderProbe();
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("loaded"));
    expect(listOrderPage).toHaveBeenCalledWith({ view: "paid", businessDate: "2026-10-12" });
    socket.open();
    // A (re)connection asks for everything again (the realtime provider's resync).
    await flush();
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("loaded"));
    const before = listOrderPage.mock.calls.length;
    socket.emit(1, "pos.order.payment_recorded");
    socket.emit(2, "pos.order.closed");
    socket.emit(3, "pos.order.payment_recorded");
    await flush();
    expect(listOrderPage).toHaveBeenCalledTimes(before);
    await act(async () => vi.advanceTimersByTime(PAID_LIST_REFRESH_SECONDS * 1000));
    await waitFor(() => expect(listOrderPage).toHaveBeenCalledTimes(before + 1));
    await act(async () => vi.advanceTimersByTime(PAID_LIST_REFRESH_SECONDS * 1000));
    await flush();
    expect(listOrderPage).toHaveBeenCalledTimes(before + 1);
  });

  it("doesn't ask again on a refresh when nothing was paid meanwhile", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("loaded"));
    await act(async () => vi.advanceTimersByTime(PAID_LIST_REFRESH_SECONDS * 1000 * 3));
    await flush();
    expect(listOrderPage).toHaveBeenCalledTimes(1);
  });
});
