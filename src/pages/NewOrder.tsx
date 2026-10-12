import { useState } from "react";
import { Icon } from "../components/Icon";
import { SettleDialog } from "../components/SettleDialog";
import { DiscountDialog } from "../components/DiscountDialog";
import {
  CategoryTab,
  MoneyDisplay,
  OrderLine,
  OrderRail,
  QuantityStepper,
} from "../components/terminal/TerminalPrimitives";
import {
  useAddOrderItem,
  useCatalog,
  useCreateOrder,
  useIdempotencyKey,
  useMutationMessage,
  usePosShift,
  usePrintAfter,
  usePropertyId,
  useRemoveOrderItem,
  useSendOrder,
  useSetProductAvailability,
} from "../hooks/usePosData";
import { ReceiptView } from "../components/ReceiptView";
import { ALL_CATEGORIES, MenuPanel } from "../register/MenuPanel";
import { OptionsSheet } from "../register/OptionsSheet";
import { RegisterLayout } from "../register/RegisterLayout";
import type { POSCatalogProduct, POSOrder, ServiceType } from "../lib/posContracts";
import { moneyFormatter } from "../lib/posMoney";

const SERVICE_TYPES: Array<{ id: ServiceType; label: string }> = [
  { id: "DINE_IN", label: "Dine in" },
  { id: "TAKEAWAY", label: "Takeaway" },
  { id: "ROOM_SERVICE", label: "Room service" },
];

/**
 * Online register: catalog from GET /pos/catalog, ticket from live order
 * mutations. Local-first offline path stays available elsewhere; this screen
 * is the cashier till against the live API.
 */
export function NewOrder() {
  const { shift } = usePosShift();
  const catalog = useCatalog();
  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORIES);
  const [search, setSearch] = useState("");
  const [serviceType, setServiceType] = useState<ServiceType>("DINE_IN");
  const [tableLabel, setTableLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [order, setOrder] = useState<POSOrder | null>(null);
  const [configuring, setConfiguring] = useState<POSCatalogProduct | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [invoiceOrderId, setInvoiceOrderId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const propertyId = usePropertyId();
  const printAfter = usePrintAfter(propertyId);
  const createOrder = useCreateOrder();
  const addItem = useAddOrderItem();
  const removeItem = useRemoveOrderItem();
  const sendOrder = useSendOrder();
  const setAvailability = useSetProductAvailability();
  const createKey = useIdempotencyKey();
  const addKey = useIdempotencyKey();
  const sendKey = useIdempotencyKey();
  const removeKey = useIdempotencyKey();

  const createError = useMutationMessage(createOrder.error);
  const addError = useMutationMessage(addItem.error);
  const removeError = useMutationMessage(removeItem.error);
  const sendError = useMutationMessage(sendOrder.error);
  const availabilityError = useMutationMessage(setAvailability.error);
  const mutationError = createError ?? addError ?? removeError ?? sendError ?? availabilityError ?? actionError;

  const currency = catalog.data?.products[0]?.currency ?? "TZS";
  const money = moneyFormatter(currency);
  const busy =
    createOrder.isPending ||
    addItem.isPending ||
    removeItem.isPending ||
    sendOrder.isPending;
  const totalItems = order?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const canMutate = Boolean(shift) && !busy;
  // Yetu adds items only to an order that is still open (not yet sent).
  const addBlocked = !shift
    ? "Open a shift before taking orders."
    : order && order.status !== "OPEN"
      ? "This order has gone to the kitchen. Start a new sale to add more."
      : null;

  async function ensureOrder(): Promise<POSOrder | null> {
    if (order) return order;
    if (!shift) {
      setActionError("Open a shift before taking orders.");
      return null;
    }
    setActionError(null);
    try {
      const created = await createOrder.mutateAsync({
        shiftId: shift.id,
        serviceType,
        tableLabel: tableLabel.trim() || undefined,
        notes: notes.trim() || undefined,
        idempotencyKey: createKey.next(),
      });
      setOrder(created);
      return created;
    } catch {
      return null;
    }
  }

  async function tapProduct(product: POSCatalogProduct) {
    if (!canMutate || addBlocked) return;
    if (product.isAvailable === false) return;
    if ((product.modifierGroups?.length ?? 0) > 0) {
      setConfiguring(product);
      return;
    }
    await addProduct(product, 1, []);
  }

  async function setSoldOut(product: POSCatalogProduct, available: boolean) {
    if (!shift || busy) return;
    setActionError(null);
    try {
      await setAvailability.mutateAsync({ productId: product.id, isAvailable: available });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update availability.");
    }
  }

  async function addProduct(product: POSCatalogProduct, quantity: number, modifierOptionIds: string[]) {
    const current = await ensureOrder();
    if (!current) return;
    setActionError(null);
    const next = await addItem.mutateAsync({
      orderId: current.id,
      productId: product.id,
      quantity,
      modifierOptionIds,
      version: current.version,
      idempotencyKey: addKey.next(),
    });
    // If STALE_VERSION returned a fresh order without applying the add, retry once.
    if (next.version === current.version && next.items.length === current.items.length) {
      const retried = await addItem.mutateAsync({
        orderId: next.id,
        productId: product.id,
        quantity,
        modifierOptionIds,
        version: next.version,
        idempotencyKey: addKey.next(),
      });
      setOrder(retried);
      setConfiguring(null);
      return;
    }
    setOrder(next);
    setConfiguring(null);
  }

  async function bumpQuantity(itemId: string, delta: number) {
    if (!order || !canMutate) return;
    const line = order.items.find((item) => item.id === itemId);
    if (!line || line.status !== "ADDED") return;
    if (delta < 0) {
      // No quantity-patch API: removing an unsent line is the certified correction.
      const next = await removeItem.mutateAsync({
        orderId: order.id,
        itemId,
        version: order.version,
        idempotencyKey: removeKey.next(),
      });
      setOrder(next);
      return;
    }
    const next = await addItem.mutateAsync({
      orderId: order.id,
      productId: line.productId,
      quantity: delta,
      version: order.version,
      idempotencyKey: addKey.next(),
    });
    setOrder(next);
  }

  async function sendToKitchen() {
    if (!order || order.items.length === 0) return;
    setActionError(null);
    const next = await sendOrder.mutateAsync({
      orderId: order.id,
      version: order.version,
      idempotencyKey: sendKey.next(),
    });
    setOrder(next);
    await printAfter(next.id);
  }

  function clearTicket() {
    setOrder(null);
    setTableLabel("");
    setNotes("");
    setSettleOpen(false);
    createKey.next();
  }

  async function afterSettled(orderId: string): Promise<void> {
    await printAfter(orderId);
    setSettleOpen(false);
    setInvoiceOrderId(orderId);
    clearTicket();
  }

  return (
    <>
      <RegisterLayout
        menu={
          <MenuPanel
            categories={catalog.data?.categories ?? []}
            products={catalog.data?.products ?? []}
            currency={catalog.data?.products[0]?.currency}
            activeCategory={activeCategory}
            onCategory={setActiveCategory}
            search={search}
            onSearch={setSearch}
            addBlocked={addBlocked}
            onTap={(product) => void tapProduct(product)}
            onSoldOutToggle={(product, available) => void setSoldOut(product, available)}
            loading={catalog.isLoading}
            failed={catalog.isError}
          />
        }
        ticket={
        <OrderRail
          title="Ticket"
          data-testid="current-order-rail"
          className="receipt-ticket"
          headerMeta={
            <>
            <div className="catalog-toolbar">
              {SERVICE_TYPES.map((type) => (
                <CategoryTab
                  key={type.id}
                  data-testid={`service-type-${type.id}`}
                  active={serviceType === type.id}
                  disabled={busy || Boolean(order)}
                  onClick={() => setServiceType(type.id)}
                >
                  {type.label}
                </CategoryTab>
              ))}
              <input
                data-testid="table-label"
                value={tableLabel}
                onChange={(event) => setTableLabel(event.target.value)}
                placeholder="Table"
                className="input w-28"
                disabled={Boolean(order)}
              />
            </div>
            <p className="mt-1 text-xs text-[var(--foreground-muted)]">
              {totalItems} {totalItems === 1 ? "item" : "items"}
              {order ? ` · ${order.orderNumber}` : " · new"}
              {order ? ` · ${order.status.replaceAll("_", " ").toLowerCase()}` : ""}
              {order?.initiatedByName ? ` · ${order.initiatedByName}` : ""}
            </p>
            </>
          }
          footer={
            <>
              <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-[var(--foreground-muted)]">
                <span>Subtotal</span>
                <MoneyDisplay className="text-right">{order ? money(order.subtotalMinor) : "—"}</MoneyDisplay>
                {(order?.discountMinor ?? 0) > 0 && (
                  <>
                    <span>Discount</span>
                    <MoneyDisplay className="text-right" data-testid="cart-discount">
                      −{money(order!.discountMinor)}
                    </MoneyDisplay>
                  </>
                )}
                <span>Tax</span>
                <MoneyDisplay className="text-right">{order ? money(order.taxMinor) : "—"}</MoneyDisplay>
                <span className="font-semibold text-[var(--foreground)]">Total</span>
                <MoneyDisplay
                  prominence="strong"
                  className="text-right text-base text-[var(--brass)]"
                  data-testid="cart-preview-total"
                >
                  {order && order.items.length > 0 ? money(order.totalMinor) : "—"}
                </MoneyDisplay>
                {(order?.paidMinor ?? 0) > 0 && (
                  <>
                    <span>Paid</span>
                    <MoneyDisplay className="text-right">{money(order!.paidMinor)}</MoneyDisplay>
                    <span>Remaining</span>
                    <MoneyDisplay className="text-right" data-testid="cart-remaining">
                      {money(order!.remainingMinor)}
                    </MoneyDisplay>
                  </>
                )}
              </div>
              <input
                data-testid="order-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Order notes"
                className="input w-full"
                disabled={Boolean(order)}
              />
              {mutationError && (
                <div className="badge badge-danger mt-3" data-testid="create-error" role="alert">
                  {mutationError}
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  data-testid="send-order"
                  onClick={() => void sendToKitchen()}
                  disabled={!order || order.items.length === 0 || order.status !== "OPEN" || busy}
                  className="btn-secondary w-full"
                >
                  <Icon name="orders" size={17} />
                  {sendOrder.isPending ? "Sending…" : "Send"}
                </button>
                <button
                  data-testid="pay-order"
                  onClick={() => setSettleOpen(true)}
                  disabled={
                    !order ||
                    order.items.length === 0 ||
                    order.status === "CLOSED" ||
                    order.status === "VOIDED" ||
                    busy
                  }
                  className="btn-pay w-full"
                >
                  Pay
                </button>
              </div>
              {order && order.items.length > 0 && (order.paidMinor ?? 0) === 0 && order.status !== "CLOSED" && order.status !== "VOIDED" && (
                <button
                  type="button"
                  data-testid="discount-order"
                  onClick={() => setDiscountOpen(true)}
                  disabled={busy}
                  className="btn-ghost mt-2 w-full text-xs"
                >
                  Apply discount
                </button>
              )}
              {order?.status === "OPEN" && order.items.some((item) => item.status === "ADDED") && (
                <p className="mt-2 text-[11px] text-[var(--foreground-muted)]">
                  Send for a kitchen ticket, or Pay to settle now.
                </p>
              )}
              {order && (
                <button
                  type="button"
                  className="btn-ghost mt-2 w-full text-xs"
                  data-testid="new-ticket"
                  onClick={clearTicket}
                  disabled={busy}
                >
                  New ticket
                </button>
              )}
            </>
          }
        >
          <ul>
            {(!order || order.items.length === 0) && (
              <li className="py-8 text-center text-xs text-[var(--foreground-muted)]">
                Tap a menu item to start this order.
              </li>
            )}
            {order?.items.map((line) => (
              <OrderLine key={line.id} data-testid={`cart-${line.name}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-[var(--foreground)]">{line.name}</span>
                  {line.modifiers && line.modifiers.length > 0 && (
                    <span className="block truncate text-[11px] text-[var(--foreground-muted)]">
                      {line.modifiers.map((item) => item.optionName).join(", ")}
                    </span>
                  )}
                  <MoneyDisplay className="mt-1 block text-[11px] text-[var(--foreground-muted)]">
                    {money(line.totalMinor)}
                  </MoneyDisplay>
                </span>
                {line.status === "ADDED" ? (
                  <QuantityStepper
                    label={line.name}
                    value={line.quantity}
                    minimum={0}
                    onDecrease={() => void bumpQuantity(line.id, -1)}
                    onIncrease={() => void bumpQuantity(line.id, 1)}
                  />
                ) : (
                  <span className="text-[11px] text-[var(--foreground-muted)]">×{line.quantity}</span>
                )}
              </OrderLine>
            ))}
          </ul>
        </OrderRail>
        }
      />

      {configuring && (
        <OptionsSheet
          product={configuring}
          currency={configuring.currency}
          pending={busy}
          onCancel={() => setConfiguring(null)}
          onAdd={(choice) => void addProduct(configuring, choice.quantity, choice.modifierOptionIds)}
        />
      )}
      {settleOpen && order && (
        <SettleDialog
          order={order}
          currency={currency}
          onClose={() => setSettleOpen(false)}
          onOrderChange={setOrder}
          onSettled={() => {
            void afterSettled(order.id);
          }}
        />
      )}
      {discountOpen && order && currency && (
        <DiscountDialog
          order={order}
          currency={currency}
          onClose={() => setDiscountOpen(false)}
          onApplied={(updated) => setOrder(updated)}
        />
      )}
      {invoiceOrderId && (
        <ReceiptView orderId={invoiceOrderId} onClose={() => setInvoiceOrderId(null)} />
      )}
    </>
  );
}
