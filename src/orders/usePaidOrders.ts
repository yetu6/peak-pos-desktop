import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useOutletId } from "../hooks/usePosData";
import { createPosApi } from "../lib/posApi";
import type { POSOrder } from "../lib/posContracts";
import { useRealtimeEvents } from "../realtime/RealtimeProvider";
import { PAID_LIST_REFRESH_SECONDS } from "./ordersSettings";
import { paidThisShift } from "./ordersWords";

/** The events after which an order may have just been paid. */
const PAID_EVENTS: readonly string[] = ["pos.order.payment_recorded", "pos.order.closed"];

/**
 * This shift's paid orders, asked for only while the Paid tab is open.
 *
 * Yetu has no paid-orders list: GET /pos/orders?active=false returns every
 * order the outlet has ever had, with no date, status filter or paging, so
 * the till asks for it only when someone looks, and keeps this shift's paid
 * ones (ordersWords.paidThisShift). A payment at the outlet only marks the
 * list out of date; while the tab is open it is asked for again at most every
 * PAID_LIST_REFRESH_SECONDS, and only if something was paid meanwhile. A
 * backend list by status and business day, paged, is a backend follow-up.
 */
export function usePaidOrders(shiftId: string | undefined, enabled: boolean) {
  const outletId = useOutletId();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["pos", "orders", "all", outletId] as const, [outletId]);
  const active = enabled && Boolean(shiftId);
  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<POSOrder[]> => {
      const { data, error } = await createPosApi().listOrders(false);
      // The same rejection the till's other hooks give (usePosData's unwrap), so problemOf reads it.
      if (error) throw new Error(JSON.stringify(error) === "{}" ? String(error) : JSON.stringify(error));
      return data ?? [];
    },
    enabled: active,
    retry: false,
    // Fresh until a payment marks it out of date.
    staleTime: Infinity,
    select: (orders: POSOrder[]) => paidThisShift(orders, shiftId),
  });
  useRealtimeEvents({ kind: "outletOrders", outletId }, (event) => {
    if (PAID_EVENTS.includes(event.type)) void queryClient.invalidateQueries({ queryKey, refetchType: "none" });
  });
  const { refetch } = query;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (queryClient.getQueryState(queryKey)?.isInvalidated) void refetch();
    }, PAID_LIST_REFRESH_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, [active, queryClient, queryKey, refetch]);
  return query;
}
