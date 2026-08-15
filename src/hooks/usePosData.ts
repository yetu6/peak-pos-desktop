import { useState } from "react";
import { useMutation, useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import {
  createPosApi,
  type FolioResponse,
  type PosOrderResponse,
  type PosSessionResponse,
  type RoomResponse,
} from "../lib/posApi";
import { devIdentityFromEnv } from "../lib/env";
import { useRealtimeEvents } from "../realtime/RealtimeProvider";
import { isOrderEvent } from "../realtime/subscriptions";

export function usePropertyId(): string {
  return devIdentityFromEnv().propertyId;
}

export function useOutletId(): string {
  return devIdentityFromEnv().outletId;
}

/**
 * The realtime payloads Peak publishes are COMPACT (orderId + changed bits),
 * never order snapshots — REST is the authoritative state and the event
 * stream is the change notification. This hook keeps the set of orders the
 * outlet has announced on the stream and fetches each one from REST when an
 * event announces a change. Backfill replays the same announcements, so a
 * reconnecting client rebuilds the same board. Orders vanish only when a
 * session closes.
 */
export function useRealtimeOrders(outletId: string): PosOrderResponse[] {
  const propertyId = usePropertyId();
  const queryClient = useQueryClient();
  const [orderIds, setOrderIds] = useState<string[]>([]);

  // Session events are published only on /topic/properties/{id}/operations.
  useRealtimeEvents({ kind: "propertyOperations", propertyId }, () => {});
  useRealtimeEvents({ kind: "outletOrders", outletId }, (event) => {
    if (event.type === "pos.session.closed") {
      setOrderIds([]);
      return;
    }
    if (!isOrderEvent(event.type) && event.type !== "pos.order_item.voided") {
      return;
    }
    const orderId =
      event.aggregateId ?? (event.payload as { orderId?: string } | null)?.orderId;
    if (!orderId) return;
    setOrderIds((prev) => (prev.includes(orderId) ? prev : [...prev, orderId]));
    queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] });
  });

  const queries = useQueries({
    queries: orderIds.map((orderId) => ({
      queryKey: ["orders", "detail", orderId],
      queryFn: async () => {
        const { data, error } = await createPosApi().getOrder(propertyId, orderId);
        if (error) throw new Error(String(error));
        return data!;
      },
      retry: false,
      staleTime: 10_000,
    })),
  });

  return queries
    .map((query) => query.data)
    .filter((order): order is PosOrderResponse => Boolean(order));
}

function sessionStorageKey(propertyId: string, outletId: string): string {
  return `peak-pos-session-${propertyId}-${outletId}`;
}

/**
 * Owns the outlet cashier session for this register. The client persists the
 * id it opened and validates it against `GET /pos-sessions/{id}` on mount;
 * an open session is reused, anything else is reopened. Peak has no
 * "find the open session for an outlet" route, so a session opened by
 * another register cannot be discovered — the operator opens one here.
 */
export function usePosSession() {
  const propertyId = usePropertyId();
  const outletId = useOutletId();
  const queryClient = useQueryClient();
  const [storedId, setStoredId] = useState<string | null>(() => {
    return localStorage.getItem(sessionStorageKey(propertyId, outletId));
  });

  const { data: session } = useQuery({
    queryKey: ["sessions", "detail", storedId],
    queryFn: async () => {
      if (!storedId) return null;
      const { data, error } = await createPosApi().getSession(propertyId, storedId);
      if (error) {
        localStorage.removeItem(sessionStorageKey(propertyId, outletId));
        return null;
      }
      if (data?.session?.status !== "open") {
        localStorage.removeItem(sessionStorageKey(propertyId, outletId));
        return null;
      }
      return data.session ?? null;
    },
    enabled: Boolean(storedId),
    staleTime: 60_000,
  });

  const open = useMutation({
    mutationFn: async (openingFloat: number) => {
      const { data, error } = await createPosApi().openSession(
        propertyId,
        outletId,
        openingFloat,
      );
      if (error) throw new Error(String(error));
      if (!data?.id) throw new Error("Session opened without an id");
      localStorage.setItem(sessionStorageKey(propertyId, outletId), data.id);
      return data;
    },
    onSuccess: (data: PosSessionResponse) => {
      setStoredId(data.id!);
      queryClient.invalidateQueries();
    },
  });

  const close = useMutation({
    mutationFn: async (actualCash?: number) => {
      if (!storedId) return;
      const { data, error } = await createPosApi().closeSession(
        propertyId,
        storedId,
        actualCash,
      );
      if (error) throw new Error(String(error));
      localStorage.removeItem(sessionStorageKey(propertyId, outletId));
      setStoredId(null);
      queryClient.invalidateQueries();
      return data;
    },
  });

  return { session: session ?? null, open, close };
}

export function useSendOrder(propertyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { orderId: string }) => {
      const { data, error } = await createPosApi().sendOrder(propertyId, args.orderId);
      if (error) throw new Error(String(error));
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kitchen"] }),
  });
}

/**
 * Composes one order: create, then add each line as its own command with its
 * own idempotency key (Peak replays a reused key, conflicts on a different
 * command). The last add response is the authoritative order snapshot.
 */
export function useCreateOrder(propertyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      sessionId: string;
      orderType: string;
      tableNumber?: string;
      lines: Array<{ menuItemId: string; quantity: number; specialRequest?: string }>;
    }) => {
      const api = createPosApi();
      const created = await api.createOrder(propertyId, {
        sessionId: args.sessionId,
        orderType: args.orderType,
        tableNumber: args.tableNumber,
      });
      if (created.error) throw new Error(String(created.error));
      if (!created.data?.id) throw new Error("Order created without an id");
      let order = created.data;
      for (const line of args.lines) {
        const added = await api.addItem(propertyId, order.id!, {
          menuItemId: line.menuItemId,
          quantity: line.quantity,
          specialRequest: line.specialRequest,
        });
        if (added.error) throw new Error(String(added.error));
        order = added.data!;
      }
      return order;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kitchen"] });
    },
  });
}

export function useSettleOrder(propertyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      orderId: string;
      method: "cash" | "room_charge" | "mobile_money";
      roomNumber?: string;
      folioId?: string;
      providerAccountId?: string;
      phoneNumber?: string;
    }) => {
      if (args.method === "room_charge") {
        if (!args.folioId) throw new Error("A folio must be resolved for a room charge");
        if (!args.roomNumber?.trim()) throw new Error("A room number is required");
      }
      if (args.method === "mobile_money") {
        if (!args.providerAccountId) throw new Error("Choose a payment provider account");
        if (!args.phoneNumber?.trim()) throw new Error("A phone number is required");
      }
      const { data, error } = await createPosApi().settleOrder(propertyId, args.orderId, {
        paymentMethod: args.method,
        folioId: args.folioId,
        roomNumber: args.roomNumber?.trim() || undefined,
        providerAccountId: args.providerAccountId,
        phoneNumber: args.phoneNumber?.trim() || undefined,
      });
      if (error) throw new Error(String(error));
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["orders", "detail", variables.orderId] });
    },
  });
}

export function useVoidOrderItem(propertyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      orderId: string;
      itemId: string;
      disposition: "RETURN_TO_STOCK" | "WASTE";
      reason: string;
    }) => {
      const { data, error } = await createPosApi().voidOrderItem(
        propertyId,
        args.orderId,
        args.itemId,
        { disposition: args.disposition, reason: args.reason },
      );
      if (error) throw new Error(String(error));
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["orders", "detail", variables.orderId] });
    },
  });
}

export function useKitchenTickets(propertyId: string) {
  const outletId = useOutletId();
  useRealtimeEvents({ kind: "outletKitchen", outletId }, () => {});
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      ticketId: string;
      action: "prepare" | "ready" | "deliver" | "void";
      reason?: string;
    }) => {
      const { data, error } = await createPosApi().transitionTicket(
        propertyId,
        args.ticketId,
        args.action,
        args.reason,
      );
      if (error) throw new Error(String(error));
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kitchen"] }),
  });
}

export function usePaymentProviderAccounts(propertyId: string) {
  return useQuery({
    queryKey: ["payments", "provider-accounts", propertyId],
    queryFn: async () => {
      const { data, error } = await createPosApi().listProviderAccounts(propertyId);
      if (error) throw new Error(String(error));
      return data ?? [];
    },
  });
}

/**
 * Resolves the folio a room charge should land on by composing the read APIs
 * Peak does expose: rooms (roomNumber -> room) -> reservations (room ->
 * checked-in stay) -> folios (open folio for that reservation). Peak has no
 * dedicated room -> folio lookup; see KNOWN GAPS.
 */
export async function resolveRoomFolio(
  propertyId: string,
  roomNumber: string,
): Promise<{ folio: FolioResponse; room: RoomResponse } | null> {
  const api = createPosApi();
  const wanted = roomNumber.trim().toLowerCase();
  if (!wanted) return null;

  const { data: rooms, error: roomsError } = await api.listRooms(propertyId);
  if (roomsError) throw new Error(String(roomsError));
  const room = (rooms ?? []).find(
    (r) => r.roomNumber?.trim().toLowerCase() === wanted,
  );
  if (!room) return null;

  const { data: reservations, error: reservationsError } =
    await api.listReservations(propertyId);
  if (reservationsError) throw new Error(String(reservationsError));
  const stays = (reservations ?? []).filter(
    (r) =>
      r.roomId === room.id &&
      (r.status === "checked_in" || r.status === "confirmed"),
  );
  if (stays.length === 0) return null;

  const { data: folios, error: foliosError } = await api.listFolios(propertyId);
  if (foliosError) throw new Error(String(foliosError));
  const reservationIds = new Set(stays.map((s) => s.id));
  const openFolio = (folios ?? []).find(
    (f) => f.status === "open" && f.reservationId && reservationIds.has(f.reservationId),
  );
  if (!openFolio) return null;

  return { folio: openFolio, room };
}

export function usePosApi() {
  const queryClient = useQueryClient();
  return {
    queryClient,
    invalidateOrders: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
    invalidateKitchen: () => queryClient.invalidateQueries({ queryKey: ["kitchen"] }),
  };
}