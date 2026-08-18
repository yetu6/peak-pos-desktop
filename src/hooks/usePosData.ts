import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { createApiClient } from "../lib/api";
import {
  createPosApi,
  type PosOrderResponse,
  type PosSessionResponse,
} from "../lib/posApi";
import { devIdentityFromEnv, type DevIdentity } from "../lib/env";
import { getApiBaseUrl } from "../lib/peakConfig";
import { useRealtimeEvents } from "../realtime/RealtimeProvider";
import { isOrderEvent } from "../realtime/subscriptions";
import { fetchOutletMenu } from "../lib/menuCatalog";
import { processPendingPrintJobs } from "../lib/printJobs";
import { getOperationalSession } from "../lib/operationalSession";
import { restRequestHeaders } from "../lib/restAuth";
import {
  decideEligibility,
  defaultEligibilityCache,
  forgetReady,
  rememberReady,
  type EligibilityCache,
  type EligibilityDecision,
} from "../lib/eligibility";

function tryDevIdentity(): DevIdentity | null {
  try {
    return devIdentityFromEnv();
  } catch {
    return null;
  }
}

export function usePropertyId(): string {
  const session = getOperationalSession();
  if (session?.propertyId) return session.propertyId;
  return devIdentityFromEnv().propertyId;
}

export function useOutletId(): string {
  const session = getOperationalSession();
  if (session?.outletId) return session.outletId;
  return devIdentityFromEnv().outletId;
}

export function useTenantId(): string {
  const session = getOperationalSession();
  if (session?.tenantId) return session.tenantId;
  return devIdentityFromEnv().tenantId;
}

const eligibilityCache = defaultEligibilityCache();

/**
 * UX gate only — Peak's POS commands already refuse an unverified tenant.
 * UNKNOWN never opens the register. A short last-known-good READY cache
 * covers a transient onboarding-read failure; realtime resync invalidates
 * this query and re-checks as soon as the till is live.
 */
export function useTenantVerification(
  cache: EligibilityCache = eligibilityCache,
  now: () => number = Date.now,
): {
  status: EligibilityDecision;
} {
  const tenantId = useTenantId();
  const query = useQuery({
    queryKey: ["tenants", "onboarding", tenantId],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: async () => {
      const { data, error } = await createApiClient().GET("/api/v1/tenants/{tenantId}/onboarding", {
        params: { path: { tenantId } },
      });
      if (error) throw new Error(String(error));
      return data;
    },
  });
  const succeeded =
    query.data?.steps?.find((candidate) => candidate.key === "verify_business")?.status ===
    "succeeded";

  useEffect(() => {
    if (!tenantId || query.isLoading || query.isError) return;
    if (succeeded) {
      rememberReady(cache, tenantId, now());
    } else {
      forgetReady(cache);
    }
  }, [tenantId, query.isLoading, query.isError, succeeded, cache, now]);

  if (!tenantId) {
    return { status: "UNKNOWN" };
  }
  if (query.isLoading) {
    return { status: "LOADING" };
  }
  if (query.isError) {
    return {
      status: decideEligibility({
        queryStatus: "error",
        verifyBusinessSucceeded: null,
        tenantId,
        now: now(),
        lastKnownGood: cache.load(tenantId),
      }),
    };
  }
  return {
    status: decideEligibility({
      queryStatus: "success",
      verifyBusinessSucceeded: succeeded,
      tenantId,
      now: now(),
      lastKnownGood: cache.load(tenantId),
    }),
  };
}

export function useOutletMenu() {
  const propertyId = usePropertyId();
  const outletId = useOutletId();
  return useQuery({
    queryKey: ["menu-items", propertyId, outletId],
    enabled: Boolean(propertyId && outletId),
    retry: false,
    queryFn: () =>
      fetchOutletMenu({
        baseUrl: getApiBaseUrl(),
        propertyId,
        outletId,
        headers: restRequestHeaders(getOperationalSession(), tryDevIdentity()),
      }),
  });
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
    mutationFn: async (actualCash: number) => {
      if (!storedId) return;
      if (!Number.isFinite(actualCash)) {
        throw new Error("Enter the cash in the drawer to close the till");
      }
      const { data, error } = await createPosApi().closeSession(
        propertyId,
        storedId,
        actualCash,
      );
      if (error) throw new Error(String(error));
      localStorage.removeItem(sessionStorageKey(propertyId, outletId));
      setStoredId(null);
      queryClient.invalidateQueries();
      if (data?.id) {
        try {
          await processPendingPrintJobs(propertyId, String(data.id));
        } catch {
          // A missing printer does not reopen the till.
        }
      }
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
      stayId?: string;
      providerAccountId?: string;
      phoneNumber?: string;
    }) => {
      if (args.method === "room_charge") {
        if (!args.stayId) throw new Error("Choose an in-house stay for a room charge");
        if (!args.roomNumber?.trim()) throw new Error("A room number is required");
      }
      if (args.method === "mobile_money") {
        if (!args.providerAccountId) throw new Error("Choose a payment provider account");
        if (!args.phoneNumber?.trim()) throw new Error("A phone number is required");
      }
      const { data, error } = await createPosApi().settleOrder(propertyId, args.orderId, {
        paymentMethod: args.method,
        stayId: args.stayId,
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
 * In-house stays a waiter may charge. Search is the dedicated POS
 * candidates path — not GET /rooms, /reservations, or /folios.
 */
export function useRoomChargeCandidates(propertyId: string, query: string) {
  const needle = query.trim();
  return useQuery({
    queryKey: ["pos", "room-charge-candidates", propertyId, needle],
    queryFn: async () => {
      const { data, error } = await createPosApi().listRoomChargeCandidates(
        propertyId,
        needle,
      );
      if (error) throw new Error(String(error));
      return data ?? [];
    },
    enabled: needle.length > 0,
  });
}

export function usePosApi() {
  const queryClient = useQueryClient();
  return {
    queryClient,
    invalidateOrders: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
    invalidateKitchen: () => queryClient.invalidateQueries({ queryKey: ["kitchen"] }),
  };
}