import { useState } from "react";
import { DiscountDialog } from "../components/DiscountDialog";
import { VoidOrderDialog } from "../components/VoidOrderDialog";
import {
  useAddOrderItem,
  useCatalog,
  useCatalogCurrency,
  useCreateOrder,
  useHasPermission,
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
import { PaymentDone } from "../register/PaymentDone";
import { PaySheet, type PaidInfo } from "../register/PaySheet";
import { NoteSheet } from "../register/NoteSheet";
import { RegisterLayout } from "../register/RegisterLayout";
import { TicketActions } from "../register/TicketActions";
import { TicketPanel } from "../register/TicketPanel";
import type { POSCatalogProduct, POSOrder, POSOrderItem, ServiceType } from "../lib/posContracts";

/**
 * The catalog option ids for a line's options, matched by group and option
 * name (Yetu keeps the names on the line, not the ids). Null when any of them
 * is no longer on the menu, so the options sheet asks again instead.
 */
function optionIdsFor(line: POSOrderItem, product: POSCatalogProduct): string[] | null {
  const ids: string[] = [];
  for (const modifier of line.modifiers ?? []) {
    const group = product.modifierGroups?.find((candidate) => candidate.isActive !== false && candidate.name === modifier.groupName);
    const option = group?.options?.find((candidate) => candidate.isAvailable !== false && candidate.name === modifier.optionName);
    if (!option) return null;
    ids.push(option.id);
  }
  return ids;
}

/**
 * Sell, against the live API: the catalog from GET /pos/catalog and the
 * ticket from the order mutations. The offline register is a separate screen.
 */
export function NewOrder() {
  const { shift } = usePosShift();
  const catalog = useCatalog();
  const currency = useCatalogCurrency();
  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORIES);
  const [search, setSearch] = useState("");
  const [serviceType, setServiceType] = useState<ServiceType>("DINE_IN");
  const [tableLabel, setTableLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [order, setOrder] = useState<POSOrder | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<Date | null>(null);
  const [configuring, setConfiguring] = useState<POSCatalogProduct | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null);
  const [paid, setPaid] = useState<PaidInfo | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canSend = useHasPermission("pos.order.send");
  const canPay = useHasPermission("pos.payment.record");
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

  const busy = createOrder.isPending || addItem.isPending || removeItem.isPending || sendOrder.isPending;
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
        // Takeaway has no table or room; a label typed under another type is not sent.
        tableLabel: serviceType === "TAKEAWAY" ? undefined : tableLabel.trim() || undefined,
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
    setNotice(null);
    if ((product.modifierGroups?.length ?? 0) > 0) {
      openOptions(product);
      return;
    }
    await addProduct(product, 1, []);
  }

  /** A fresh options sheet starts without an earlier add's refusal. */
  function openOptions(product: POSCatalogProduct) {
    addItem.reset();
    createOrder.reset();
    setConfiguring(product);
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
    try {
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
      } else {
        setOrder(next);
      }
      setConfiguring(null);
    } catch {
      // The words come from addItem.error.
    }
  }

  /** Another of the same line, with the same options (a new line: Yetu has no quantity change). */
  async function addAnother(line: POSOrderItem) {
    if (!canMutate) return;
    const product = catalog.data?.products.find((candidate) => candidate.id === line.productId);
    if (!product || product.isAvailable === false) {
      setActionError(`${line.name} can't be added just now.`);
      return;
    }
    const ids = optionIdsFor(line, product);
    if (ids === null) {
      openOptions(product);
      return;
    }
    await addProduct(product, 1, ids);
  }

  async function removeLine(line: POSOrderItem) {
    if (!order || !canMutate || line.status !== "ADDED") return;
    try {
      const next = await removeItem.mutateAsync({
        orderId: order.id,
        itemId: line.id,
        version: order.version,
        idempotencyKey: removeKey.next(),
      });
      setOrder(next);
      setSelectedLineId(null);
    } catch {
      // The words come from removeItem.error.
    }
  }

  async function sendToKitchen() {
    if (!order || order.items.length === 0) return;
    setActionError(null);
    try {
      const next = await sendOrder.mutateAsync({
        orderId: order.id,
        version: order.version,
        idempotencyKey: sendKey.next(),
      });
      setOrder(next);
      setSentAt(new Date());
      await printAfter(next.id);
    } catch {
      // The words come from sendOrder.error.
    }
  }

  function clearTicket() {
    setOrder(null);
    setTableLabel("");
    setNotes("");
    setSelectedLineId(null);
    setSentAt(null);
    setSettleOpen(false);
    createKey.next();
  }

  function afterPaid(info: PaidInfo) {
    setSettleOpen(false);
    setPaid(info);
    // The receipt Yetu made on closing is printed as before; the till doesn't hear back here (S8).
    void printAfter(info.order.id);
  }

  function newSale() {
    setPaid(null);
    clearTicket();
  }

  return (
    <>
      <RegisterLayout
        menu={
          <MenuPanel
            categories={catalog.data?.categories ?? []}
            products={catalog.data?.products ?? []}
            currency={currency}
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
          <TicketPanel
            order={order}
            currency={currency}
            serviceType={serviceType}
            onServiceType={setServiceType}
            label={tableLabel}
            onLabel={setTableLabel}
            selectedLineId={selectedLineId}
            onSelectLine={setSelectedLineId}
            onAddAnother={(line) => void addAnother(line)}
            onRemoveLine={(line) => void removeLine(line)}
            lineBusy={busy}
            sentAt={sentAt}
            error={mutationError}
            notice={notice}
            actions={
              <TicketActions
                order={order}
                currency={currency}
                busy={busy}
                sending={sendOrder.isPending}
                canSend={canSend}
                canPay={canPay}
                onSend={() => void sendToKitchen()}
                onPay={() => setSettleOpen(true)}
                onDiscount={() => setDiscountOpen(true)}
                onVoid={() => setVoidOpen(true)}
                onNote={() => setNoteOpen(true)}
                onNewSale={clearTicket}
              />
            }
          />
        }
      />

      {configuring && (
        <OptionsSheet
          product={configuring}
          currency={currency ?? configuring.currency}
          pending={busy}
          error={createError ?? addError}
          onCancel={() => setConfiguring(null)}
          onAdd={(choice) => void addProduct(configuring, choice.quantity, choice.modifierOptionIds)}
        />
      )}
      {settleOpen && order && currency && (
        <PaySheet
          order={order}
          currency={currency}
          onClose={() => setSettleOpen(false)}
          onOrderChange={setOrder}
          onPaid={afterPaid}
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
      {voidOpen && order && (
        <VoidOrderDialog
          order={order}
          currency={currency}
          onClose={() => setVoidOpen(false)}
          onVoided={() => {
            const number = order.orderNumber;
            clearTicket();
            setNotice(`Order ${number} was voided. The kitchen has been told.`);
          }}
        />
      )}
      {noteOpen && (
        <NoteSheet
          note={order ? (order.notes ?? "") : notes}
          locked={order !== null}
          onSave={setNotes}
          onClose={() => setNoteOpen(false)}
        />
      )}
      {paid && currency && (
        <PaymentDone
          paid={paid}
          currency={currency}
          onNewSale={newSale}
          onViewReceipt={() => {
            setReceiptOrderId(paid.order.id);
            newSale();
          }}
        />
      )}
      {receiptOrderId && <ReceiptView orderId={receiptOrderId} onClose={() => setReceiptOrderId(null)} />}
    </>
  );
}
