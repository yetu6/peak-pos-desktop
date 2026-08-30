import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPosApi } from "../lib/posApi";
import { describePosError } from "../lib/posErrors";
import { devIdentityFromEnv } from "../lib/env";
import { useRealtimeEvents } from "../realtime/RealtimeProvider";
import { isOrderEvent } from "../realtime/subscriptions";
import { processPendingPrintJobs } from "../lib/printJobs";
import { getOperationalSession } from "../lib/operationalSession";
import type {
  CashMovementType,
  PaymentMethod,
  POSOrder,
  POSShift,
  ServiceType,
} from "../lib/posContracts";

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

/** Every mutation-with-side-effects generates exactly one Idempotency-Key
 *  when the user initiates the action. A later automatic or manual retry of
 *  THAT SAME intended mutation must reuse it; a new user action mints a new
 *  one. Callers get a fresh key by calling `next()` once per new intent. */
export function useIdempotencyKey(): { current: string; next: () => string } {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return {
    current: key,
    next: () => {
      const fresh = crypto.randomUUID();
      setKey(fresh);
      return fresh;
    },
  };
}

async function unwrap<T>(promise: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(JSON.stringify(error) === "{}" ? String(error) : JSON.stringify(error));
  if (data === undefined) return undefined as T;
  return data;
}

/** Surfaces the coherent operational message for any thrown mutation error. */
export function useMutationMessage(error: unknown): string | null {
  if (!error) return null;
  try {
    return describePosError(JSON.parse((error as Error).message)).message;
  } catch {
    return describePosError(error).message;
  }
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export function useCatalog() {
  const propertyId = usePropertyId();
  const outletId = useOutletId();
  return useQuery({
    queryKey: ["pos", "catalog", propertyId, outletId],
    queryFn: () => unwrap(createPosApi().getCatalog()),
    retry: false,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Shift (till)
// ---------------------------------------------------------------------------

function shiftStorageKey(propertyId: string, outletId: string): string {
  return `peak-pos-shift-${propertyId}-${outletId}`;
}

export function usePosShift() {
  const propertyId = usePropertyId();
  const outletId = useOutletId();
  const queryClient = useQueryClient();
  const [storedId, setStoredId] = useState<string | null>(() =>
    localStorage.getItem(shiftStorageKey(propertyId, outletId)),
  );

  const { data: shift } = useQuery({
    queryKey: ["pos", "shift", storedId],
    queryFn: async () => {
      if (!storedId) return null;
      const { data, error } = await createPosApi().getShift(storedId);
      if (error || !data || data.status !== "OPEN") {
        localStorage.removeItem(shiftStorageKey(propertyId, outletId));
        return null;
      }
      return data;
    },
    enabled: Boolean(storedId),
    staleTime: 30_000,
  });

  const open = useMutation({
    mutationFn: async (args: { openingCashMinor: number; idempotencyKey: string }) =>
      unwrap(createPosApi().openShift(args.openingCashMinor, args.idempotencyKey)),
    onSuccess: (data: POSShift) => {
      localStorage.setItem(shiftStorageKey(propertyId, outletId), data.id);
      setStoredId(data.id);
      queryClient.invalidateQueries();
    },
  });

  const close = useMutation({
    mutationFn: async (args: {
      countedCashMinor: number;
      supervisorStaffId?: string;
      supervisorPin?: string;
      idempotencyKey: string;
    }) => {
      if (!storedId) throw new Error("No open shift");
      return unwrap(
        createPosApi().closeShift(
          storedId,
          {
            countedCashMinor: args.countedCashMinor,
            supervisorStaffId: args.supervisorStaffId,
            supervisorPin: args.supervisorPin,
          },
          args.idempotencyKey,
        ),
      );
    },
    onSuccess: (data: POSShift) => {
      if (data.status === "CLOSED") {
        localStorage.removeItem(shiftStorageKey(propertyId, outletId));
        setStoredId(null);
      }
      queryClient.invalidateQueries();
    },
  });

  return { shift: shift ?? null, open, close };
}

export function useCashMovements(shiftId: string | undefined) {
  return useQuery({
    queryKey: ["pos", "cash-movements", shiftId],
    queryFn: async () => (await unwrap(createPosApi().listCashMovements(shiftId!))).items,
    enabled: Boolean(shiftId),
  });
}

export function useRecordCashMovement(shiftId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { movementType: CashMovementType; amountMinor: number; reason: string; idempotencyKey: string }) =>
      unwrap(
        createPosApi().recordCashMovement(
          { movementType: args.movementType, amountMinor: args.amountMinor, reason: args.reason },
          args.idempotencyKey,
        ),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pos", "cash-movements", shiftId] });
      queryClient.invalidateQueries({ queryKey: ["pos", "shift"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** Authoritative outlet-bound orders. REST is the source of truth on load and
 *  reconnect; realtime events only tell this hook which order to re-fetch. */
export function useActiveOrders() {
  const outletId = useOutletId();
  const query = useQuery({
    queryKey: ["pos", "orders", "active", outletId],
    queryFn: () => unwrap(createPosApi().listOrders(true)),
    retry: false,
  });
  const queryClient = useQueryClient();
  useRealtimeEvents({ kind: "outletOrders", outletId }, async (event) => {
    if (event.type === "pos.shift.closed") {
      queryClient.setQueryData(["pos", "orders", "active", outletId], []);
      return;
    }
    if (!isOrderEvent(event.type)) return;
    queryClient.invalidateQueries({ queryKey: ["pos", "orders", "active", outletId] });
  });
  return query;
}

export function useOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: ["pos", "order", orderId],
    queryFn: () => unwrap(createPosApi().getOrder(orderId!)),
    enabled: Boolean(orderId),
  });
}

function invalidateOrders(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["pos", "orders"] });
  queryClient.invalidateQueries({ queryKey: ["pos", "order"] });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { shiftId: string; serviceType: ServiceType; tableLabel?: string; notes?: string; idempotencyKey: string }) =>
      unwrap(
        createPosApi().createOrder(
          { shiftId: args.shiftId, serviceType: args.serviceType, tableLabel: args.tableLabel, notes: args.notes },
          args.idempotencyKey,
        ),
      ),
    onSuccess: () => invalidateOrders(queryClient),
  });
}

/** STALE_VERSION never gets a blind retry: the caller must refetch and let
 *  the operator re-apply intent against the refreshed order. */
export function useAddOrderItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      orderId: string;
      productId: string;
      quantity: number;
      modifierOptionIds?: string[];
      version: number;
      idempotencyKey: string;
    }) =>
      unwrap(
        createPosApi().addItem(
          args.orderId,
          { productId: args.productId, quantity: args.quantity, modifierOptionIds: args.modifierOptionIds, version: args.version },
          args.idempotencyKey,
        ),
      ),
    onSuccess: (order: POSOrder) => {
      queryClient.setQueryData(["pos", "order", order.id], order);
      invalidateOrders(queryClient);
    },
  });
}

export function useRemoveOrderItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { orderId: string; itemId: string; version: number; idempotencyKey: string }) =>
      unwrap(createPosApi().removeItem(args.orderId, args.itemId, args.version, args.idempotencyKey)),
    onSuccess: (order: POSOrder) => {
      queryClient.setQueryData(["pos", "order", order.id], order);
      invalidateOrders(queryClient);
    },
  });
}

export function useSendOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { orderId: string; version: number; idempotencyKey: string }) => {
      await unwrap(createPosApi().sendOrder(args.orderId, args.version, args.idempotencyKey));
      return unwrap(createPosApi().getOrder(args.orderId));
    },
    onSuccess: (order: POSOrder) => {
      queryClient.setQueryData(["pos", "order", order.id], order);
      invalidateOrders(queryClient);
    },
  });
}

export function useTransitionOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      orderId: string;
      status: "PREPARING" | "READY" | "SERVED";
      version: number;
      idempotencyKey: string;
    }) => {
      await unwrap(createPosApi().transitionStatus(args.orderId, args.status, args.version, args.idempotencyKey));
      return unwrap(createPosApi().getOrder(args.orderId));
    },
    onSuccess: (order: POSOrder) => {
      queryClient.setQueryData(["pos", "order", order.id], order);
      invalidateOrders(queryClient);
    },
  });
}

export function useRecordTender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      orderId: string;
      paymentMethod: PaymentMethod;
      amountMinor: number;
      reference?: string;
      version: number;
      idempotencyKey: string;
    }) => {
      await unwrap(
        createPosApi().recordTender(
          args.orderId,
          { paymentMethod: args.paymentMethod, amountMinor: args.amountMinor, reference: args.reference, version: args.version },
          args.idempotencyKey,
        ),
      );
      return unwrap(createPosApi().getOrder(args.orderId));
    },
    onSuccess: (order: POSOrder) => {
      queryClient.setQueryData(["pos", "order", order.id], order);
      invalidateOrders(queryClient);
    },
  });
}

export function useChargeToRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { orderId: string; stayId: string; idempotencyKey: string }) => {
      await unwrap(createPosApi().chargeToRoom(args.orderId, args.stayId, args.idempotencyKey));
      return unwrap(createPosApi().getOrder(args.orderId));
    },
    onSuccess: (order: POSOrder) => {
      queryClient.setQueryData(["pos", "order", order.id], order);
      invalidateOrders(queryClient);
    },
  });
}

/** Whole-order correction with a different supervisor's PIN. There is no
 *  per-line void-after-send in the certified contract — do not invent one. */
export function useVoidOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      orderId: string;
      reason: string;
      supervisorStaffId: string;
      supervisorPin: string;
      version: number;
      idempotencyKey: string;
    }) =>
      unwrap(
        createPosApi().voidOrder(
          args.orderId,
          { reason: args.reason, supervisorStaffId: args.supervisorStaffId, supervisorPin: args.supervisorPin, version: args.version },
          args.idempotencyKey,
        ),
      ),
    onSuccess: () => invalidateOrders(queryClient),
  });
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export function useReceipt(orderId: string | undefined) {
  return useQuery({
    queryKey: ["pos", "receipt", orderId],
    queryFn: () => unwrap(createPosApi().getReceipt(orderId!)),
    enabled: Boolean(orderId),
    retry: false,
  });
}

export function useReprintReceipt() {
  const queryClient = useQueryClient();
  const propertyId = usePropertyId();
  return useMutation({
    mutationFn: async (args: { orderId: string; idempotencyKey: string }) => {
      const receipt = await unwrap(createPosApi().reprintReceipt(args.orderId, args.idempotencyKey));
      // The reprint is a chained pos_print_jobs row; the terminal claims and
      // physically prints it exactly like the original and kitchen tickets.
      await processPendingPrintJobs(propertyId, receipt.id);
      return receipt;
    },
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["pos", "receipt", variables.orderId] }),
  });
}

// ---------------------------------------------------------------------------
// Room charge — offered only once a real, non-empty candidate lookup for
// this property has succeeded (see docs/POS_DESKTOP_R6A_CLOSURE.md, backend
// contract gap #1: the POS session carries no capability list at all, so
// "LODGING active" cannot be read directly; a candidate to charge to is the
// only truthful, non-invented signal a POS session can obtain).
// ---------------------------------------------------------------------------

export function useRoomChargeCandidates(query: string) {
  const needle = query.trim();
  return useQuery({
    queryKey: ["pos", "room-charge-candidates", needle],
    queryFn: () => unwrap(createPosApi().listRoomChargeCandidates(needle)),
    enabled: needle.length > 0,
  });
}

/** One-shot probe (empty query) so the workspace knows whether to offer
 *  "Charge to room" at all before the cashier opens the settle dialog. */
export function useRoomChargeAvailability() {
  return useQuery({
    queryKey: ["pos", "room-charge-candidates", "__probe__"],
    queryFn: () => unwrap(createPosApi().listRoomChargeCandidates("")),
    select: (candidates) => candidates.length > 0,
    staleTime: 60_000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// POS Day Close — a distinct, deliberately out-of-the-way action; the
// backend alone knows whether this staff member and this property qualify
// (see error mapping: FORBIDDEN / CAPABILITY_NOT_ENABLED both surface here).
// ---------------------------------------------------------------------------

export function useCloseBusinessDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) => unwrap(createPosApi().closeBusinessDay(idempotencyKey)),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

// ---------------------------------------------------------------------------
// Print jobs (kitchen tickets, receipts) already sent for a source id.
// ---------------------------------------------------------------------------

export function usePrintAfter(propertyId: string) {
  const printing = useRef(false);
  return async (sourceId: string | undefined): Promise<void> => {
    if (!sourceId || printing.current) return;
    printing.current = true;
    try {
      await processPendingPrintJobs(propertyId, sourceId);
    } finally {
      printing.current = false;
    }
  };
}

export function useOrdersByStatus(statuses: POSOrder["status"][]) {
  const { data: orders = [] } = useActiveOrders();
  return useMemo(() => orders.filter((order) => statuses.includes(order.status)), [orders, statuses]);
}
