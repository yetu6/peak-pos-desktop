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

/**
 * R6A-C: this property's authoritative effective capabilities and this
 * staff member's own current-property POS permission grants, both received
 * once at PIN login (`createRestrictedPOSSession`) and held only in the
 * in-memory operational session — never derived from property_type, an
 * outlet, a role NAME, or local configuration. UX composition only: every
 * mutation these gate is still re-checked against this same authority by
 * the backend on every call, and a stale/forged value here changes nothing
 * about what the server will actually accept.
 */
export function usePropertyCapabilities(): string[] {
  return getOperationalSession()?.capabilities ?? [];
}

export function usePosPermissions(): string[] {
  return getOperationalSession()?.permissions ?? [];
}

export function useHasCapability(code: string): boolean {
  return usePropertyCapabilities().includes(code);
}

export function useHasPermission(resourceAction: string): boolean {
  return usePosPermissions().includes(resourceAction);
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

export function useSetProductAvailability() {
  const queryClient = useQueryClient();
  const propertyId = usePropertyId();
  const outletId = useOutletId();
  return useMutation({
    mutationFn: (input: { productId: string; isAvailable: boolean }) =>
      unwrap(createPosApi().setProductAvailability(input.productId, input.isAvailable)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["pos", "catalog", propertyId, outletId] }),
  });
}

/**
 * The outlet's one authoritative currency — mirrors how the local-first
 * path reads `LocalCatalogView.currency` from the signed offline snapshot.
 * `POSCatalog` itself carries no top-level currency field (Peak catalogs are
 * single-currency per outlet), so any fetched product's currency is the
 * outlet's currency. Undefined only until the catalog has loaded or if it
 * is genuinely empty; callers must not assume a default in that window.
 */
export function useCatalogCurrency(): string | undefined {
  const catalog = useCatalog();
  return catalog.data?.products[0]?.currency;
}

// ---------------------------------------------------------------------------
// Shift (till)
// ---------------------------------------------------------------------------

function shiftStorageKey(propertyId: string, outletId: string): string {
  return `peak-pos-shift-${propertyId}-${outletId}`;
}

/**
 * The shift-id pointer itself lives in TanStack Query's cache (not a local
 * useState) so every call site — the header's TillControls and a page's own
 * `usePosShift()` are two independent hook invocations — reads and writes
 * the SAME value. A local useState here previously desynced them: opening a
 * shift updated the header but left the selling workspace showing "No open
 * shift" until a full remount. Found live during R6A-C visual certification.
 */
function shiftIdQueryKey(propertyId: string, outletId: string) {
  return ["pos", "shift-id", propertyId, outletId] as const;
}

export function usePosShift() {
  const propertyId = usePropertyId();
  const outletId = useOutletId();
  const queryClient = useQueryClient();
  const idKey = shiftIdQueryKey(propertyId, outletId);

  // Authoritative resume: server open shift wins over a stale localStorage id.
  const { data: shift, isLoading: shiftLoading } = useQuery({
    queryKey: ["pos", "shift", "current", propertyId, outletId],
    queryFn: async () => {
      const api = createPosApi();
      const current = await api.getCurrentShift();
      if (current.data && (current.data.status === "OPEN" || current.data.status === "PENDING_VARIANCE_APPROVAL")) {
        localStorage.setItem(shiftStorageKey(propertyId, outletId), current.data.id);
        queryClient.setQueryData(idKey, current.data.id);
        return current.data;
      }
      const storedId =
        queryClient.getQueryData<string | null>(idKey) ??
        localStorage.getItem(shiftStorageKey(propertyId, outletId));
      if (!storedId) {
        queryClient.setQueryData(idKey, null);
        return null;
      }
      const { data, error } = await api.getShift(storedId);
      if (error || !data || (data.status !== "OPEN" && data.status !== "PENDING_VARIANCE_APPROVAL")) {
        localStorage.removeItem(shiftStorageKey(propertyId, outletId));
        queryClient.setQueryData(idKey, null);
        return null;
      }
      queryClient.setQueryData(idKey, data.id);
      return data;
    },
    staleTime: 30_000,
    retry: false,
  });

  const open = useMutation({
    mutationFn: async (args: { openingCashMinor: number; idempotencyKey: string }) =>
      unwrap(createPosApi().openShift(args.openingCashMinor, args.idempotencyKey)),
    onSuccess: (data: POSShift) => {
      localStorage.setItem(shiftStorageKey(propertyId, outletId), data.id);
      queryClient.setQueryData(idKey, data.id);
      queryClient.setQueryData(["pos", "shift", "current", propertyId, outletId], data);
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
      const currentId =
        shift?.id ??
        queryClient.getQueryData<string | null>(idKey) ??
        localStorage.getItem(shiftStorageKey(propertyId, outletId));
      if (!currentId) throw new Error("No open shift");
      return unwrap(
        createPosApi().closeShift(
          currentId,
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
        queryClient.setQueryData(idKey, null);
        queryClient.setQueryData(["pos", "shift", "current", propertyId, outletId], null);
      }
      queryClient.invalidateQueries();
    },
  });

  return { shift: shift ?? null, open, close, isLoading: shiftLoading };
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
    mutationFn: (args: {
      shiftId: string;
      serviceType?: ServiceType;
      tableLabel?: string;
      notes?: string;
      idempotencyKey: string;
    }) =>
      unwrap(
        createPosApi().createOrder(
          {
            shiftId: args.shiftId,
            serviceType: args.serviceType,
            tableLabel: args.tableLabel,
            notes: args.notes,
          },
          args.idempotencyKey,
        ),
      ),
    onSuccess: (order: POSOrder) => {
      queryClient.setQueryData(["pos", "order", order.id], order);
      invalidateOrders(queryClient);
    },
  });
}

export function useAddOrderItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      orderId: string;
      productId: string;
      quantity: number;
      modifierOptionIds?: string[];
      version: number;
      idempotencyKey: string;
    }) => {
      try {
        return await unwrap(
          createPosApi().addItem(
            args.orderId,
            {
              productId: args.productId,
              quantity: args.quantity,
              modifierOptionIds: args.modifierOptionIds,
              version: args.version,
            },
            args.idempotencyKey,
          ),
        );
      } catch (err) {
        // STALE_VERSION: refetch once and let the caller retry with the fresh version.
        const message = err instanceof Error ? err.message : String(err);
        if (/STALE_VERSION|stale version/i.test(message)) {
          return unwrap(createPosApi().getOrder(args.orderId));
        }
        throw err;
      }
    },
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
      try {
        await unwrap(
          createPosApi().transitionStatus(args.orderId, args.status, args.version, args.idempotencyKey),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/STALE_VERSION|stale version/i.test(message)) {
          const fresh = await unwrap(createPosApi().getOrder(args.orderId));
          await unwrap(
            createPosApi().transitionStatus(
              args.orderId,
              args.status,
              fresh.version,
              args.idempotencyKey,
            ),
          );
          return unwrap(createPosApi().getOrder(args.orderId));
        }
        throw err;
      }
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
// Room charge — R6A-C: offered only when the authoritative session context
// says both the property has LODGING active and this staff member holds
// pos.room_charge.create at this property (see docs/
// POS_DESKTOP_R6A_CLOSURE.md and POS_DESKTOP_R6A_CERTIFICATION.md — this
// replaces the earlier empty-candidate-search heuristic now that fbc-peak
// exposes the real signal at PIN login).
// ---------------------------------------------------------------------------

export function useRoomChargeCandidates(query: string) {
  const needle = query.trim();
  return useQuery({
    queryKey: ["pos", "room-charge-candidates", needle],
    queryFn: () => unwrap(createPosApi().listRoomChargeCandidates(needle)),
    enabled: needle.length > 0,
  });
}

/** Whether to offer "Charge to room" at all — a synchronous read of the
 *  session's own authoritative context, not a network probe. Backend
 *  capability/permission checks on the actual posting endpoint remain the
 *  real authority regardless of what this returns. */
export function useRoomChargeAvailability(): { data: boolean } {
  const hasLodging = useHasCapability("LODGING");
  const canRoomCharge = useHasPermission("pos.room_charge.create");
  return { data: hasLodging && canRoomCharge };
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
