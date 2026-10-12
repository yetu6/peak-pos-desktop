import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletId } from "../hooks/usePosData";
import { createPosApi } from "../lib/posApi";
import type { POSOrder } from "../lib/posContracts";
import { useRealtimeEvents } from "../realtime/RealtimeProvider";
import { paidThisShift } from "./ordersWords";

/** The events after which an order may have just been paid. */
const PAID_EVENTS: readonly string[] = ["pos.order.payment_recorded", "pos.order.closed"];

/**
 * This shift's paid orders, asked for only while the Paid tab is open.
 *
 * Yetu has no paid-orders list: GET /pos/orders?active=false returns every
 * order the outlet has ever had, with no date, status filter or paging, so
 * the till asks for it only when someone looks, and keeps this shift's paid
 * ones (ordersWords.paidThisShift). A backend list by status and business
 * day, paged, is a backend follow-up; until then this grows with the outlet.
 */
export function usePaidOrders(shiftId: string | undefined, enabled: boolean) {
  const outletId = useOutletId();
  const queryKey = ["pos", "orders", "all", outletId] as const;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<POSOrder[]> => {
      const { data, error } = await createPosApi().listOrders(false);
      // The same rejection the till's other hooks give (usePosData's unwrap), so problemOf reads it.
      if (error) throw new Error(JSON.stringify(error) === "{}" ? String(error) : JSON.stringify(error));
      return data ?? [];
    },
    enabled: enabled && Boolean(shiftId),
    retry: false,
    select: (orders: POSOrder[]) => paidThisShift(orders, shiftId),
  });
  useRealtimeEvents({ kind: "outletOrders", outletId }, (event) => {
    if (PAID_EVENTS.includes(event.type)) void queryClient.invalidateQueries({ queryKey });
  });
  return query;
}
