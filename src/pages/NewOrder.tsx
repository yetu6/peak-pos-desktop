import { useDeviceSessionOptional } from "../auth/DeviceSessionProvider";
import { useCallback, useEffect, useRef, useState } from "react";
import { billNotPrintedWords, printProblemOnce } from "../print/printProblems";
import { DiscountDialog } from "../components/DiscountDialog";
import { VoidItemDialog } from "../components/VoidItemDialog";
import { VoidOrderDialog } from "../components/VoidOrderDialog";
import {
  useAddOrderItem,
  useCatalog,
  useCatalogCurrency,
  useCreateOrder,
  useFetchOrder,
  useHasPermission,
  useIdempotencyKey,
  useOrder,
  usePosShift,
  usePrintAfter,
  usePropertyId,
  usePrintBill,
  useRemoveOrderItem,
  useReprintKitchenTickets,
  useSetLineQuantity,
  useSendOrder,
  useSetProductAvailability,
} from "../hooks/usePosData";
import { ReceiptView } from "../components/ReceiptView";
import { ALL_CATEGORIES, MenuPanel } from "../register/MenuPanel";
import { OptionsSheet } from "../register/OptionsSheet";
import { takesMore, unsentLines } from "../register/rounds";
import { useTillMenu } from "../fnb/useTillMenu";
import { sizesOf, tagNote } from "../fnb/fnbWords";
import { PaymentDone } from "../register/PaymentDone";
import { PaySheet, type PaidInfo } from "../register/PaySheet";
import { NoteSheet } from "../register/NoteSheet";
import { RegisterLayout } from "../register/RegisterLayout";
import { TicketActions } from "../register/TicketActions";
import { LiveOpenOrdersBar } from "../register/OpenOrdersBar";
import { PaperPreviewSheet } from "../register/PaperPreviewSheet";
import { TicketPanel, type WaitingTap } from "../register/TicketPanel";
import { sellProblem } from "../register/registerWords";
import { REGISTER_QUIET_AFTER_RETURN_MS } from "../register/registerSettings";
import { useRequestKey } from "../lib/useRequestKey";
import type { POSCatalogProduct, POSOrder, POSOrderItem, ServiceType } from "../lib/posContracts";
import { orderName } from "../lib/orderNumber";
import { billProblem, voidedWords, kitchenReprintProblem, kitchenReprintWords } from "../orders/ordersWords";

/**
 * Sell, against the live API: the catalog from GET /pos/catalog and the
 * ticket from the order mutations. The offline register is a separate screen.
 *
 * `resume` is an order to carry on with (F-236): the one this person left on
 * the ticket to look at Orders or the kitchen, or one chosen in Orders with
 * Add items. `onTicket` hears of the order on the ticket while it is open.
 */
export function NewOrder({
  resume = null,
  onTicket,
  onSwitch,
}: {
  resume?: POSOrder | null;
  onTicket?: (order: POSOrder | null) => void;
  /** Another open order onto the ticket, or a new one (null): Sell starts again on it. */
  onSwitch?: (order: POSOrder | null) => void;
} = {}) {
  const { shift } = usePosShift();
  const staffId = useDeviceSessionOptional()?.session?.staffId;
  const catalog = useCatalog();
  // The Restaurant & Bar module's menu (groups, sizes, tags); none: sell as before.
  const tillMenu = useTillMenu();
  const menu = tillMenu.data;
  const currency = useCatalogCurrency();
  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORIES);
  const [search, setSearch] = useState("");
  const [serviceType, setServiceType] = useState<ServiceType>(resume?.serviceType ?? "DINE_IN");
  const [tableLabel, setTableLabel] = useState(resume?.tableLabel ?? "");
  const [notes, setNotes] = useState("");
  const [order, setOrder] = useState<POSOrder | null>(resume);
  // The order as it is now, for taps waiting their turn (their render's `order` is older).
  const orderRef = useRef<POSOrder | null>(resume);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<Date | null>(null);
  const [configuring, setConfiguring] = useState<POSCatalogProduct | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  // The sent line being voided (fbc-peak 00125), while its sheet is open.
  const [voidingLine, setVoidingLine] = useState<POSOrderItem | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // A late word (a slip that didn't print) follows the void it belongs to,
  // never replaces it -- and never attaches to something said since.
  const voidNotice = useRef<string | null>(null);
  const sayVoided = useCallback((words: string) => {
    voidNotice.current = words;
    setNotice(words);
  }, []);
  const addNotice = useCallback(
    (words: string) => setNotice((now) => (now !== null && now === voidNotice.current ? `${now} ${words}` : words)),
    [],
  );
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
  const setLineQuantity = useSetLineQuantity();
  const sendOrder = useSendOrder();
  const setAvailability = useSetProductAvailability();
  const createKey = useIdempotencyKey();
  const addKey = useIdempotencyKey();
  // A send whose answer was lost is the same request again (same key); a refused one is new.
  const sendRequest = useRequestKey();
  const removeKey = useIdempotencyKey();
  const billKey = useRequestKey();
  const printBill = usePrintBill();
  const reprintKitchen = useReprintKitchenTickets();
  // Every paper is shown before it prints (owner, 2026-10-21): which preview is open.
  const [preview, setPreview] = useState<"ROUND" | "BILL" | null>(null);
  // Pay with new items shows their papers first, then takes payment.
  const [payAfterPrint, setPayAfterPrint] = useState(false);
  // The kitchen papers of a send, still on their way to the printer: the
  // ticket stays on this order until the printer has answered (F-233).
  const [printing, setPrinting] = useState(false);
  const reprintKey = useIdempotencyKey();
  const quantityKey = useIdempotencyKey();

  function adopt(next: POSOrder | null) {
    orderRef.current = next;
    setOrder(next);
  }

  // A sheet refused because the order changed on another till: the ticket
  // takes Yetu's order as it is now, as the sheet's words say.
  const fetchOrder = useFetchOrder();
  async function reloadOrder() {
    const current = orderRef.current;
    if (!current) return;
    try {
      const fresh = await fetchOrder(current.id);
      if (fresh.status === "CLOSED" || fresh.status === "VOIDED") {
        clearTicket();
        setNotice(`${orderName(fresh)} is ${fresh.status === "CLOSED" ? "paid" : "cancelled"} already. Start a new sale.`);
      } else {
        adopt(fresh);
      }
    } catch {
      // The sheet still says what was refused; the next action asks Yetu again.
    }
  }

  // The ticket's open order is told to the shell, so it is still here when the person comes back.
  const ticketRef = useRef(onTicket);
  ticketRef.current = onTicket;
  useEffect(() => {
    ticketRef.current?.(order && order.status !== "CLOSED" && order.status !== "VOIDED" ? order : null);
  }, [order]);

  // An order brought back to Sell is asked for once more, as Yetu has it now:
  // another till may have added to it, paid it or voided it meanwhile.
  const [resumedId] = useState(resume?.id);
  const latest = useOrder(resumedId);
  const checked = useRef(false);
  useEffect(() => {
    const fresh = latest.data;
    if (checked.current || !latest.isFetchedAfterMount || !fresh) return;
    checked.current = true;
    const current = orderRef.current;
    if (current?.id !== fresh.id) return;
    if (fresh.status === "CLOSED" || fresh.status === "VOIDED") {
      clearTicket();
      setNotice(`${orderName(fresh)} is ${fresh.status === "CLOSED" ? "paid" : "cancelled"} already. Start a new sale.`);
    } else if (fresh.version > current.version) {
      adopt(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest.isFetchedAfterMount, latest.data]);

  const createProblem = sellProblem(createOrder.error, "create");
  const addProblem = sellProblem(addItem.error, "add");
  const removeProblem = sellProblem(removeItem.error, "remove");
  const quantityProblem = sellProblem(setLineQuantity.error, "quantity");
  const sendProblem = sellProblem(sendOrder.error, "send");
  const availabilityProblem = sellProblem(setAvailability.error, "availability");
  const createError = createProblem?.words ?? null;
  const addError = addProblem?.words ?? null;
  const mutationError = createProblem ?? addProblem ?? removeProblem ?? quantityProblem ?? sendProblem ?? availabilityProblem ?? actionError;
  // Only a send whose answer was lost is offered again as it was; the order stays on the ticket.
  const retrySend = sendProblem?.kind === "network" && order ? () => void sendToKitchen() : undefined;

  const busy = createOrder.isPending || addItem.isPending || removeItem.isPending || setLineQuantity.isPending || sendOrder.isPending;
  const canMutate = Boolean(shift) && !busy;
  // An order takes more after it was sent, as the next round (S17a); a Yetu
  // before rounds takes nothing once sent, and a paid or voided order never.
  const addBlocked = !shift
    ? "Open a shift before taking orders."
    : order && !takesMore(order)
      ? order.status === "CLOSED" || order.status === "VOIDED"
        ? "This order is finished. Start a new sale."
        : "This order has gone to the kitchen. Start a new sale to add more."
      : null;

  async function ensureOrder(): Promise<POSOrder | null> {
    if (orderRef.current) return orderRef.current;
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
      adopt(created);
      return created;
    } catch {
      return null;
    }
  }

  // Taps made while an add is with Yetu wait their turn, in the order they
  // were made (F-230): two quick taps on a beer are two beers, never one.
  const taps = useRef<Promise<void>>(Promise.resolve());
  // Those taps, on the ticket at once as being added until Yetu answers (F-247).
  const [waiting, setWaiting] = useState<WaitingTap[]>([]);
  const tapCount = useRef(0);
  const adding = createOrder.isPending || addItem.isPending;
  // Until when a tap on the menu is the person reaching for the payment screen that just went (F-232).
  const quietUntil = useRef(0);

  function tapProduct(product: POSCatalogProduct) {
    if (!shift || addBlocked || (busy && !adding)) return;
    if (Date.now() < quietUntil.current) return;
    if (product.isAvailable === false) return;
    setNotice(null);
    if ((product.modifierGroups?.length ?? 0) > 0 || sizesOf(menu, product.id).length > 1) {
      if (busy) return;
      openOptions(product);
      return;
    }
    const key = ++tapCount.current;
    setWaiting((current) => [...current, { key, name: product.name }]);
    taps.current = taps.current
      .then(() => addProduct(product, 1, []))
      .finally(() => setWaiting((current) => current.filter((tap) => tap.key !== key)));
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

  async function addProduct(product: POSCatalogProduct, quantity: number, modifierOptionIds: string[], variantId?: string) {
    const current = await ensureOrder();
    if (!current || !takesMore(current)) return;
    setActionError(null);
    try {
      const next = await addItem.mutateAsync({
        orderId: current.id,
        productId: product.id,
        variantId,
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
          variantId,
          quantity,
          modifierOptionIds,
          version: next.version,
          idempotencyKey: addKey.next(),
        });
        adopt(retried);
      } else {
        adopt(next);
      }
      setConfiguring(null);
    } catch {
      // The words come from addItem.error.
    }
  }

  /** How many of an unsent line: Yetu keeps the line's price, options and size. */
  async function changeQuantity(line: POSOrderItem, quantity: number) {
    if (!order || !canMutate || line.status !== "ADDED" || quantity < 1) return;
    setActionError(null);
    try {
      const next = await setLineQuantity.mutateAsync({
        orderId: order.id,
        itemId: line.id,
        quantity,
        version: order.version,
        idempotencyKey: quantityKey.next(),
      });
      adopt(next);
    } catch {
      // The words come from setLineQuantity.error.
    }
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
      // F-260 (fbc-peak #286): the last line off closes the order in Yetu. The
      // table and note stay on the ticket; the next item starts a new order.
      if (next.status === "VOIDED") {
        adopt(null);
        createKey.next();
      } else {
        adopt(next);
      }
      setSelectedLineId(null);
    } catch {
      // The words come from removeItem.error.
    }
  }

  async function sendToKitchen(): Promise<boolean> {
    if (!order || order.items.length === 0) return false;
    setActionError(null);
    try {
      const next = await sendOrder.mutateAsync({
        orderId: order.id,
        version: order.version,
        idempotencyKey: sendRequest.keyFor(["send", order.id, order.version].join("|")),
      });
      adopt(next);
      setSentAt(new Date());
      // The kitchen ticket prints on its own time: the send is done, and Send
      // and pay opens the payment now (F-241), whatever the printer does.
      setPrinting(true);
      void printAfter(next.id)
        .then((results) => {
          const words = printProblemOnce(results, "kitchen ticket");
          if (words) setNotice(words);
        })
        .finally(() => setPrinting(false));
      return true;
    } catch (error) {
      // The words come from sendOrder.error. Yetu refused it: the next press is a new request.
      if (sellProblem(error, "send")?.kind !== "network") sendRequest.forget();
      return false;
    }
  }

  /** Pay: what isn't sent goes to the kitchen first (Send and pay), then the payment opens. */
  async function pay() {
    if (order && canSend && takesMore(order) && unsentLines(order) > 0) {
      // Every paper is shown before it prints (owner, 2026-10-21): the new items' first.
      setPayAfterPrint(true);
      setPreview("ROUND");
      return;
    }
    setSettleOpen(true);
  }

  // The line being voided as the order has it now: after a reload its
  // quantity may have dropped, or it may be gone (voided on another till),
  // and the sheet must count from what is really there.
  const liveVoidingLine = voidingLine && order
    ? order.items.find((item) => item.id === voidingLine.id && item.status === "SENT") ?? null
    : null;

  function clearTicket() {
    adopt(null);
    setTableLabel("");
    setNotes("");
    setSelectedLineId(null);
    setSentAt(null);
    setSettleOpen(false);
    // A void sheet belongs to the order it was opened on: never the next sale's.
    setVoidOpen(false);
    setVoidingLine(null);
    createKey.next();
  }

  function afterPaid(info: PaidInfo) {
    setSettleOpen(false);
    setPaid(info);
    // Nothing prints after payment (2026-10-20): the EFD gives the tax receipt, the bill came before.
    // The drawer opened as the cash was taken (Pay); one that didn't is said on Sell.
  }

  // The bill before payment (fbc-peak #288): printed for the ticket's order; said on Sell.
  function printTheBill() {
    const current = orderRef.current;
    if (!current || printBill.isPending) return;
    setNotice(null);
    printBill.mutate(
      { orderId: current.id, idempotencyKey: billKey.keyFor([current.id, current.version, current.billPrints?.length ?? 0].join("|")) },
      {
        onSuccess: ({ failed }) => {
          billKey.forget();
          setNotice(failed ? billNotPrintedWords(failed) : `The bill for ${orderName(current)} was sent to the printer.`);
        },
        onError: (error) => {
          const refusal = billProblem(error);
          setNotice(refusal?.words ?? "The bill wasn't printed. Try again.");
          if (refusal?.kind !== "network") billKey.forget();
        },
      },
    );
  }

  // Print order with nothing new: the last round's papers again, marked COPY
  // (the reprint Orders already has); said on Sell.
  function printOrderAgain() {
    const current = orderRef.current;
    const round = current?.roundsSent ?? 0;
    if (!current || round === 0 || reprintKitchen.isPending) return;
    setNotice(null);
    reprintKitchen.mutate(
      { orderId: current.id, idempotencyKey: reprintKey.next(), roundNumber: round },
      {
        onSuccess: ({ failed }) => setNotice(kitchenReprintWords(round, current.roundsSent, failed)),
        onError: (error) => setNotice(kitchenReprintProblem(error)?.words ?? "The order wasn't printed again. Try again."),
      },
    );
  }

  function newSale(byItself = false) {
    if (byItself) quietUntil.current = Date.now() + REGISTER_QUIET_AFTER_RETURN_MS;
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
            menu={menu}
            currency={currency}
            activeCategory={activeCategory}
            onCategory={setActiveCategory}
            search={search}
            onSearch={setSearch}
            addBlocked={addBlocked}
            onTap={tapProduct}
            onSoldOutToggle={(product, available) => void setSoldOut(product, available)}
            loading={catalog.isLoading}
            failed={catalog.isError}
          />
        }
        ticket={
          <TicketPanel
            bar={
              // The open orders above the ticket (owner, 2026-10-21).
              onSwitch ? (
                <LiveOpenOrdersBar
                  current={order}
                  staffId={staffId}
                  currency={currency}
                  // Nothing in flight is left behind: a switch waits for the printer's answer.
                  disabled={busy || printing || printBill.isPending || reprintKitchen.isPending}
                  onPick={onSwitch}
                  onNew={() => onSwitch(null)}
                />
              ) : undefined
            }
            order={order}
            currency={currency}
            tagsOf={(productId) => (menu ? tagNote(menu, productId) : undefined)}
            serviceType={serviceType}
            onServiceType={setServiceType}
            label={tableLabel}
            onLabel={setTableLabel}
            selectedLineId={selectedLineId}
            onSelectLine={setSelectedLineId}
            onQuantity={(line, quantity) => void changeQuantity(line, quantity)}
            onRemoveLine={(line) => void removeLine(line)}
            onVoidLine={setVoidingLine}
            waiting={waiting}
            lineBusy={busy}
            sentAt={sentAt}
            error={mutationError}
            onRetry={retrySend}
            retrying={sendOrder.isPending}
            notice={notice}
            actions={
              <TicketActions
                order={order}
                currency={currency}
                busy={busy}
                sending={sendOrder.isPending}
                canSend={canSend}
                canPay={canPay}
                onSend={() => setPreview("ROUND")}
                onReprint={() => setPreview("ROUND")}
                onPay={() => void pay()}
                onDiscount={() => setDiscountOpen(true)}
                onVoid={() => setVoidOpen(true)}
                onNote={() => setNoteOpen(true)}
                onPrintBill={canSend ? () => setPreview("BILL") : undefined}
                printingBill={printBill.isPending}
                onNewSale={clearTicket}
              />
            }
          />
        }
      />

      {preview && order ? (
        <PaperPreviewSheet
          orderId={order.id}
          kind={preview}
          busy={sendOrder.isPending || printBill.isPending || reprintKitchen.isPending}
          nothingNew={unsentLines(order) === 0}
          refusalOf={(error) => {
            const refusal = preview === "BILL" ? billProblem(error) : sellProblem(error, "send");
            return refusal && refusal.kind !== "network" ? refusal.words : null;
          }}
          tagsOf={(productId) => (menu ? tagNote(menu, productId) : undefined)}
          onBack={() => {
            setPreview(null);
            setPayAfterPrint(false);
          }}
          onPrint={() => {
            const kind = preview;
            const thenPay = payAfterPrint;
            setPreview(null);
            setPayAfterPrint(false);
            if (kind === "BILL") printTheBill();
            else if (unsentLines(order) > 0) {
              void sendToKitchen().then((sent) => {
                if (sent && thenPay) setSettleOpen(true);
              });
            } else printOrderAgain();
          }}
        />
      ) : null}

      {configuring && (
        <OptionsSheet
          product={configuring}
          currency={currency ?? configuring.currency}
          pending={busy}
          error={createError ?? addError}
          onCancel={() => setConfiguring(null)}
          onAdd={(choice) => void addProduct(configuring, choice.quantity, choice.modifierOptionIds, choice.variantId)}
          sizes={sizesOf(menu, configuring.id)}
          description={menu?.products[configuring.id]?.description}
          happy={menu?.prices?.[configuring.id]}
        />
      )}
      {settleOpen && order && currency && (
        <PaySheet
          order={order}
          currency={currency}
          onClose={() => setSettleOpen(false)}
          onOrderChange={adopt}
          onPaid={afterPaid}
          onDrawerProblem={setNotice}
        />
      )}
      {discountOpen && order && currency && (
        <DiscountDialog
          order={order}
          currency={currency}
          onClose={() => setDiscountOpen(false)}
          onApplied={adopt}
        />
      )}
      {voidOpen && order && (
        <VoidOrderDialog
          order={order}
          currency={currency}
          onClose={() => setVoidOpen(false)}
          onStale={() => void reloadOrder()}
          onPrintProblem={addNotice}
          onVoided={() => {
            const words = voidedWords(order);
            clearTicket();
            sayVoided(words);
          }}
        />
      )}
      {voidingLine && order && liveVoidingLine && (
        <VoidItemDialog
          order={order}
          line={liveVoidingLine}
          currency={currency}
          onClose={() => setVoidingLine(null)}
          onStale={() => void reloadOrder()}
          onPrintProblem={addNotice}
          onVoided={(fresh, words) => {
            setSelectedLineId(null);
            // Nothing left to serve: Yetu closed the order. The next item starts a new one.
            if (fresh.status === "VOIDED") {
              clearTicket();
              sayVoided(`${words} Nothing is left on ${orderName(fresh)}, so it's closed.`);
            } else {
              adopt(fresh);
              sayVoided(words);
            }
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
