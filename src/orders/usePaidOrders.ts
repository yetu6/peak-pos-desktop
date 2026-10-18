import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useOutletId } from "../hooks/usePosData";
import { createPosApi } from "../lib/posApi";
import type { POSOrder, POSOrderPage, POSShift } from "../lib/posContracts";
import { useRealtimeEvents } from "../realtime/RealtimeProvider";
import { PAID_LIST_REFRESH_SECONDS, PAID_SEARCH_MOST_PAGES } from "./ordersSettings";

/** The events after which an order may have just been paid. */
const PAID_EVENTS: readonly string[] = ["pos.order.payment_recorded", "pos.order.closed"];

export interface PaidOrders {
  /** The day's paid orders read so far, the latest paid first; null until asked for. */
  orders: POSOrder[] | null;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => void;
  /** Yetu has more of the day's paid orders than have been read. */
  hasMore: boolean;
  /** Read the next page ("Show more"). */
  loadMore: () => void;
  loadingMore: boolean;
  /** Every paid order of the day has been read, so a search covered them all. */
  searchedAll: boolean;
}

function unwrapPage({ data, error }: { data?: POSOrderPage; error?: unknown }): POSOrderPage {
  // The same rejection the till's other hooks give (usePosData's unwrap), so problemOf reads it.
  if (error) throw new Error(JSON.stringify(error) === "{}" ? String(error) : JSON.stringify(error));
  return data ?? { items: [], nextCursor: null };
}

/**
 * The paid orders of the shift's business day at this outlet, every till's
 * (GET /pos/orders?view=paid&businessDate=…, S5b), asked for only while the
 * Paid tab is open: one of Yetu's pages at a time, the latest paid first,
 * "Show more" reading the next. While a search is typed the rest of the day
 * is read, up to PAID_SEARCH_MOST_PAGES pages, so the search never says
 * "no match" of orders it hasn't read. A payment at the outlet only marks the
 * list out of date; while the tab is open it is asked for again at most every
 * PAID_LIST_REFRESH_SECONDS, and only if something was paid meanwhile.
 */
export function usePaidOrders(shift: Pick<POSShift, "id" | "businessDate"> | undefined, enabled: boolean, searching: boolean): PaidOrders {
  const outletId = useOutletId();
  const queryClient = useQueryClient();
  const businessDate = shift?.businessDate;
  const queryKey = useMemo(() => ["pos", "orders", "paid", outletId, businessDate] as const, [outletId, businessDate]);
  const active = enabled && Boolean(shift?.id && businessDate);
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrapPage(await createPosApi().listOrderPage({ view: "paid", businessDate, ...(pageParam ? { cursor: pageParam } : {}) })),
    getNextPageParam: (last: POSOrderPage) => last.nextCursor ?? undefined,
    enabled: active,
    retry: false,
    // Fresh until a payment marks it out of date.
    staleTime: Infinity,
  });
  useRealtimeEvents({ kind: "outletOrders", outletId }, (event) => {
    if (PAID_EVENTS.includes(event.type)) void queryClient.invalidateQueries({ queryKey, refetchType: "none" });
  });
  const { refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isError } = query;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (queryClient.getQueryState(queryKey)?.isInvalidated) void refetch();
    }, PAID_LIST_REFRESH_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, [active, queryClient, queryKey, refetch]);

  const pagesRead = query.data?.pages.length ?? 0;
  useEffect(() => {
    if (!active || !searching || !hasNextPage || isFetchingNextPage || isError || pagesRead >= PAID_SEARCH_MOST_PAGES) return;
    void fetchNextPage();
  }, [active, searching, hasNextPage, isFetchingNextPage, isError, pagesRead, fetchNextPage]);

  const orders = useMemo(() => {
    if (!query.data) return null;
    // An order paid while the pages were read can show on two of them: kept once, where it came first.
    const seen = new Set<string>();
    const kept: POSOrder[] = [];
    for (const order of query.data.pages.flatMap((page) => page.items)) {
      if (seen.has(order.id)) continue;
      seen.add(order.id);
      kept.push(order);
    }
    return kept;
  }, [query.data]);

  return {
    orders,
    isLoading: query.isLoading,
    isError,
    isSuccess: query.isSuccess,
    refetch: () => void refetch(),
    hasMore: Boolean(hasNextPage),
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    loadingMore: isFetchingNextPage,
    searchedAll: query.isSuccess && !hasNextPage,
  };
}
