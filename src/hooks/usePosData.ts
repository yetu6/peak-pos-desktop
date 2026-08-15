import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPosApi, type PosOrderResponse } from "../lib/posApi";
import { devIdentityFromEnv } from "../lib/env";
import { useRealtimeEvents } from "../realtime/RealtimeProvider";

export function usePropertyId(): string {
  return devIdentityFromEnv().propertyId;
}

export function useOutletId(): string {
  return devIdentityFromEnv().outletId;
}

/**
 * Active orders are NOT queryable by REST (the backend exposes no order-list
 * endpoint) — the event stream IS the orders source. This hook reconstructs
 * the client's view of open orders from committed events only; it never
 * invents state. KNOWN GAP: a fresh client cannot backfill orders that were
 * created before it subscribed.
 */
export function useRealtimeOrders(outletId: string): PosOrderResponse[] {
  const [orders, setOrders] = useState<PosOrderResponse[]>([]);
  useRealtimeEvents({ kind: "outletOrders", outletId }, (event) => {
    const order = event.payload as unknown as PosOrderResponse;
    if (!order?.id) return;
    if (
      event.type === "pos.order.created" ||
      event.type === "pos.order.updated" ||
      event.type === "pos.order.settled"
    ) {
      setOrders((prev) => {
        const exists = prev.some((o) => o.id === order.id);
        return exists
          ? prev.map((o) => (o.id === order.id ? order : o))
          : [...prev, order];
      });
    } else if (event.type === "pos.session.closed") {
      setOrders([]);
    }
  });
  return orders;
}

export function usePosApi() {
  const queryClient = useQueryClient();
  return {
    queryClient,
    invalidateOrders: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
    invalidateKitchen: () =>
      queryClient.invalidateQueries({ queryKey: ["kitchen"] }),
  };
}

export function useKitchenTickets(propertyId: string) {
  return useQuery({
    queryKey: ["kitchen", "tickets", propertyId],
    queryFn: async () => {
      const { data, error } = await createPosApi().listKitchenTickets(propertyId);
      if (error) throw new Error(String(error));
      return data ?? [];
    },
  });
}

export function useTransitionTicket(propertyId: string) {
  const { invalidateKitchen } = usePosApi();
  return useMutation({
    mutationFn: async (args: {
      ticketId: string;
      action: "prepare" | "ready" | "deliver" | "void";
    }) => {
      const { data, error } = await createPosApi().transitionTicket(
        propertyId,
        args.ticketId,
        args.action,
      );
      if (error) throw new Error(String(error));
      return data;
    },
    onSuccess: () => invalidateKitchen(),
  });
}

export function useSendOrder(propertyId: string) {
  const { invalidateOrders } = usePosApi();
  return useMutation({
    mutationFn: async (args: { orderId: string }) => {
      const { data, error } = await createPosApi().sendOrder(propertyId, args.orderId);
      if (error) throw new Error(String(error));
      return data;
    },
    onSuccess: () => invalidateOrders(),
  });
}

export function useOpenSession(propertyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { outletId: string; openingFloat: number }) => {
      const { data, error } = await createPosApi().openSession(
        propertyId,
        args.outletId,
        args.openingFloat,
      );
      if (error) throw new Error(String(error));
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}