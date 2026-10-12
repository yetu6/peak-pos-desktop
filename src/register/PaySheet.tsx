import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { moneyFieldText } from "../cash/NoteCounterSheet";
import { Banner, Button, Field, Keypad, Money, MoneyField, QuickCash, RefusalNotice, SearchField, Sheet, type KeypadKey, type Refusal } from "../components/system";
import {
  useChargeToRoom,
  useIdempotencyKey,
  useOrder,
  useRecordTender,
  useRoomChargeAvailability,
  useRoomChargeCandidates,
} from "../hooks/usePosData";
import { formatMoney } from "../lib/money";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import type { PaymentMethod, POSOrder, POSRoomChargeCandidate } from "../lib/posContracts";
import { toMinor } from "../lib/posMoney";
import { orderPlaceWords, paymentMethodWords, serviceTypeWords, type SettlementMethod } from "../lib/words";
import { roomChargeProblem, tenderProblem } from "./registerWords";

const CASH_FORM = "pay-cash";
const RECORDED_FORM = "pay-recorded";

/** Named setting: how long the room search waits after typing before it asks Yetu. */
export const ROOM_SEARCH_WAIT_MS = 250;

/**
 * Named setting: while a payment's answer was lost, how often the sheet asks
 * Yetu again for the order (it asks at once, then this often) until Yetu
 * answers.
 */
export const PAY_CHECK_EVERY_SECONDS = 5;

/** A payment or room charge whose answer was lost: what was asked, and the order as it was before. */
interface Unsure {
  before: POSOrder;
  method: SettlementMethod;
  changeMinor: number;
  roomNumber?: string;
  /** The last time the sheet asked, Yetu couldn't be reached. */
  failed: boolean;
}

/** The tenders Yetu takes (posContracts PaymentMethod), in this order. */
export const TENDER_METHODS: readonly PaymentMethod[] = ["CASH", "MOBILE_MONEY", "EXTERNAL_CARD", "BANK_TRANSFER", "OTHER"];

type Method = PaymentMethod | "ROOM_CHARGE";

/** What a recorded (not processed) method asks the person to do first. */
const RECORDED_STEP: Record<Exclude<PaymentMethod, "CASH">, string> = {
  MOBILE_MONEY: "Take payment on your own machine, then confirm here.",
  EXTERNAL_CARD: "Take payment on your own machine, then confirm here.",
  BANK_TRANSFER: "Check the transfer has reached the account, then confirm here.",
  OTHER: "Write how it was paid in the reference, then confirm here.",
};

export interface PaidInfo {
  order: POSOrder;
  method: SettlementMethod;
  /** Change given for the last cash tender: the cash received less what was owed. */
  changeMinor: number;
  roomNumber?: string;
  /** Part of it was paid before this last tender. */
  split?: boolean;
}

export interface TenderRequest {
  method: PaymentMethod;
  amountMinor: number;
  reference?: string;
  changeMinor: number;
}

/**
 * Take payment for the order on the ticket. Card, mobile money, bank
 * transfer and other are recorded, not processed: the guest pays on the
 * outlet's own machine or account and the person confirms here. A payment
 * for less than is owed leaves the rest to pay by any method (split). Charge
 * to room is offered with lodging and the permission, and not once part is
 * paid (the backend's rule).
 */
export function PaySheet({
  order,
  currency,
  onClose,
  onOrderChange,
  onPaid,
}: {
  order: POSOrder;
  currency: string;
  onClose: () => void;
  onOrderChange?: (order: POSOrder) => void;
  onPaid: (paid: PaidInfo) => void;
}) {
  const [live, setLive] = useState(order);
  // The last part payment Yetu recorded, said back to the person.
  const [recorded, setRecorded] = useState<number | null>(null);
  const [roomQuery, setRoomQuery] = useState("");
  const [needle, setNeedle] = useState("");
  const recordTender = useRecordTender();
  const chargeToRoom = useChargeToRoom();
  const tenderKey = useIdempotencyKey();
  const roomChargeKey = useIdempotencyKey();
  // A retry of the same request (after a lost response) reuses its key, so Yetu
  // records it once; a changed request gets a new key. Every success changes the
  // order's version, which is part of the request, so the next payment is new.
  const lastTender = useRef<{ request: string; key: string } | null>(null);
  const lastRoomCharge = useRef<{ request: string; key: string } | null>(null);

  function keyFor(last: { current: { request: string; key: string } | null }, request: string, fresh: () => string): string {
    if (last.current?.request === request) return last.current.key;
    const key = fresh();
    last.current = { request, key };
    return key;
  }
  const roomAvailable = useRoomChargeAvailability().data === true;
  const candidates = useRoomChargeCandidates(needle);
  // The order as Yetu has it now, fetched again when another till changed it first.
  const latestOrder = useOrder(order.id);

  function adopt(fresh: POSOrder | undefined) {
    if (!fresh) return;
    setLive(fresh);
    onOrderChange?.(fresh);
  }

  useEffect(() => setLive(order), [order]);
  useEffect(() => {
    const wait = setTimeout(() => setNeedle(roomQuery.trim()), ROOM_SEARCH_WAIT_MS);
    return () => clearTimeout(wait);
  }, [roomQuery]);

  // A payment whose answer was lost: nothing is assumed until Yetu says what it recorded.
  const [unsure, setUnsureState] = useState<Unsure | null>(null);
  const unsureRef = useRef<Unsure | null>(null);
  const setUnsure = (next: Unsure | null) => {
    unsureRef.current = next;
    setUnsureState(next);
  };
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  // What Yetu said after a lost answer, when it isn't a payment done.
  const [answer, setAnswer] = useState<string | null>(null);

  /** Ask Yetu for the order and act only on its answer. */
  async function check() {
    const current = unsureRef.current;
    if (!current || checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    let result: Awaited<ReturnType<typeof latestOrder.refetch>> | undefined;
    try {
      result = await latestOrder.refetch();
    } catch {
      result = undefined;
    }
    checkingRef.current = false;
    setChecking(false);
    if (unsureRef.current !== current) return;
    if (!result || result.status !== "success" || !result.data) {
      setUnsure({ ...current, failed: true });
      return;
    }
    settle(current, result.data);
  }

  function settle(current: Unsure, fresh: POSOrder) {
    setUnsure(null);
    recordTender.reset();
    chargeToRoom.reset();
    const room = current.method === "ROOM_CHARGE";
    if (fresh.status === "CLOSED" || fresh.remainingMinor <= 0) {
      // Yetu recorded it: the order is paid.
      onOrderChange?.(fresh);
      onPaid({
        order: fresh,
        method: current.method,
        changeMinor: current.changeMinor,
        roomNumber: current.roomNumber,
        split: current.before.paidMinor > 0,
      });
      return;
    }
    if (fresh.paidMinor > current.before.paidMinor) {
      // Yetu recorded a part payment.
      setLive(fresh);
      setRecorded(fresh.paidMinor - current.before.paidMinor);
      onOrderChange?.(fresh);
      return;
    }
    if (fresh.version === current.before.version) {
      // Yetu recorded nothing. Asking again is the same request (the same key).
      setAnswer(
        room
          ? "Yetu didn't record that charge, so nothing went on the room bill. Charge it again when you're ready."
          : "Yetu didn't record that payment, so nothing was taken. Take it again when the guest is ready.",
      );
      return;
    }
    // The order changed on another till meanwhile: Yetu's latest, and any next payment is a new request.
    lastTender.current = null;
    lastRoomCharge.current = null;
    adopt(fresh);
    setAnswer("This order changed on another till. The amounts here are Yetu's latest: check them, then try again.");
  }

  const isUnsure = unsure !== null;
  useEffect(() => {
    if (!isUnsure) return;
    void check();
    const id = setInterval(() => void check(), PAY_CHECK_EVERY_SECONDS * 1000);
    return () => clearInterval(id);
    // Starts when an answer is lost and stops when Yetu has answered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnsure]);

  const problem = isUnsure
    ? null
    : answer
      ? { kind: "other", words: answer }
      : (tenderProblem(recordTender.error) ?? roomChargeProblem(chargeToRoom.error));
  // The till doesn't lock itself while a payment is with Yetu, or while what Yetu recorded is unknown.
  useHoldIdleLock(recordTender.isPending || chargeToRoom.isPending || isUnsure);

  return (
    <PaySheetView
      order={live}
      currency={currency}
      roomAvailable={roomAvailable}
      roomQuery={roomQuery}
      onRoomQuery={setRoomQuery}
      candidates={candidates.data ?? []}
      searching={Boolean(needle) && candidates.isFetching}
      searched={Boolean(needle)}
      pending={recordTender.isPending || chargeToRoom.isPending}
      unsure={unsure ? { failed: unsure.failed, checking, room: unsure.method === "ROOM_CHARGE" } : null}
      onCheck={() => void check()}
      problem={problem ?? null}
      recordedMinor={recorded}
      onClose={onClose}
      onTender={(request) => {
        setAnswer(null);
        const before = live;
        recordTender.mutate(
          {
            orderId: live.id,
            paymentMethod: request.method,
            amountMinor: request.amountMinor,
            reference: request.reference,
            version: live.version,
            idempotencyKey: keyFor(
              lastTender,
              [request.method, request.amountMinor, request.reference ?? "", live.version].join("|"),
              tenderKey.next,
            ),
          },
          {
            onSuccess: (updated) => {
              setLive(updated);
              setRecorded(request.amountMinor);
              onOrderChange?.(updated);
              if ((updated.remainingMinor ?? 0) <= 0 || updated.status === "CLOSED") {
                onPaid({ order: updated, method: request.method, changeMinor: request.changeMinor, split: live.paidMinor > 0 });
              }
            },
            onError: (error) => {
              const kind = tenderProblem(error)?.kind;
              if (kind === "stale") void latestOrder.refetch().then((result) => adopt(result.data));
              // The answer was lost: Yetu may or may not have recorded it. Ask before anything else.
              if (kind === "network") setUnsure({ before, method: request.method, changeMinor: request.changeMinor, failed: false });
            },
          },
        );
      }}
      onChargeRoom={(candidate) => {
        setAnswer(null);
        const before = live;
        chargeToRoom.mutate(
          {
            orderId: live.id,
            stayId: candidate.stayId,
            idempotencyKey: keyFor(lastRoomCharge, [candidate.stayId, live.version].join("|"), roomChargeKey.next),
          },
          {
            onSuccess: (updated) => {
              onPaid({ order: updated, method: "ROOM_CHARGE", changeMinor: 0, roomNumber: candidate.roomNumber });
            },
            onError: (error) => {
              if (roomChargeProblem(error)?.kind === "network") {
                setUnsure({ before, method: "ROOM_CHARGE", changeMinor: 0, roomNumber: candidate.roomNumber, failed: false });
              }
            },
          },
        );
      }}
    />
  );
}

export interface PaySheetViewProps {
  order: POSOrder;
  currency: string;
  roomAvailable: boolean;
  roomQuery: string;
  onRoomQuery: (query: string) => void;
  candidates: readonly POSRoomChargeCandidate[];
  searching: boolean;
  searched: boolean;
  pending: boolean;
  /** A payment whose answer was lost, while Yetu is asked what it recorded. */
  unsure?: { failed: boolean; checking: boolean; room: boolean } | null;
  onCheck?: () => void;
  /** Why Yetu refused the payment: a 403 shows as a permission notice. */
  problem: Refusal | string | null;
  /** The last part payment Yetu recorded on this order, if any. */
  recordedMinor?: number | null;
  onClose: () => void;
  onTender: (request: TenderRequest) => void;
  onChargeRoom: (candidate: POSRoomChargeCandidate) => void;
  /** Fixtures start part-way through. */
  initialMethod?: Method;
  initialReceived?: string;
  initialStayId?: string;
}

export function PaySheetView({
  order,
  currency,
  roomAvailable,
  roomQuery,
  onRoomQuery,
  candidates,
  searching,
  searched,
  pending: requestPending,
  unsure = null,
  onCheck,
  problem,
  recordedMinor = null,
  onClose,
  onTender,
  onChargeRoom,
  initialMethod = "CASH",
  initialReceived = "",
  initialStayId,
}: PaySheetViewProps) {
  const [method, setMethod] = useState<Method>(initialMethod);
  // While what Yetu recorded is unknown, nothing new is taken and the sheet stays.
  const pending = requestPending || unsure !== null;
  const [received, setReceived] = useState(initialReceived);
  const [amountText, setAmountText] = useState("");
  const [reference, setReference] = useState("");
  const [stayId, setStayId] = useState<string | null>(initialStayId ?? null);
  const methodRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const paneRef = useRef<HTMLDivElement>(null);
  // Focus moves into a method's field when the sheet opens and when a method
  // is pressed (click or Enter), never when the arrow keys move between methods.
  const focusPane = useRef(true);

  // Each payment Yetu records gives the order a new version: what was typed
  // for it is cleared, so a second tap can't record the same money again.
  const [seenVersion, setSeenVersion] = useState(order.version);
  if (order.version !== seenVersion) {
    setSeenVersion(order.version);
    setReceived("");
    setAmountText("");
    setReference("");
    setStayId(null);
  }

  const due = order.remainingMinor;
  const nothingDue = due <= 0;
  const partPaid = order.paidMinor > 0;
  const methods: Method[] = roomAvailable ? [...TENDER_METHODS, "ROOM_CHARGE"] : [...TENDER_METHODS];
  // Yetu charges a room only for an order the kitchen has (SENT, READY or SERVED) and nothing paid yet.
  const roomBlocked = partPaid
    ? "Charge to room isn't possible once part of the bill is paid."
    : order.status === "OPEN"
      ? "Charge to room: send it to the kitchen first."
      : order.status === "PREPARING"
        ? "Charge to room: once the kitchen has it ready."
        : null;
  const usable = (candidate: Method) => !nothingDue && !(candidate === "ROOM_CHARGE" && roomBlocked !== null);

  // Prices below are Yetu's (what is owed); the change and a part payment's
  // remainder are worked out from the cash the person types, in whole minor units.
  const receivedMinor = toMinor(received);
  const cashTaken = !nothingDue && receivedMinor != null && receivedMinor > 0 ? Math.min(receivedMinor, due) : null;
  const amount = amountText.trim() ? toMinor(amountText) : due;
  const over = amount != null && amount > due;
  const chosenStay = candidates.find((candidate) => candidate.stayId === stayId) ?? null;

  function chooseMethod(next: Method, pressed: boolean) {
    focusPane.current = pressed;
    setMethod(next);
    setAmountText("");
    setReference("");
  }

  useEffect(() => {
    if (!focusPane.current) return;
    focusPane.current = false;
    paneRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [method]);

  function onMethodKey(event: KeyboardEvent<HTMLDivElement>) {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !back) return;
    event.preventDefault();
    const open = methods.filter(usable);
    const index = open.indexOf(method);
    const next = open[(index + (forward ? 1 : -1) + open.length) % open.length];
    chooseMethod(next, false);
    methodRefs.current[methods.indexOf(next)]?.focus();
  }

  function onCashKey(key: KeypadKey) {
    if (key === "delete") setReceived((text) => text.slice(0, -1));
    else if (key === "clear") setReceived("");
    // No leading zeros: "0" or "00" on an empty amount adds nothing.
    else setReceived((text) => (text === "" && /^0+$/.test(key) ? text : text + key));
  }

  function takeCash() {
    if (receivedMinor == null || cashTaken == null || pending) return;
    onTender({ method: "CASH", amountMinor: cashTaken, changeMinor: Math.max(0, receivedMinor - due) });
  }

  function confirmRecorded() {
    if (method === "CASH" || method === "ROOM_CHARGE" || nothingDue || amount == null || amount <= 0 || over || pending) return;
    onTender({ method, amountMinor: amount, reference: reference.trim() || undefined, changeMinor: 0 });
  }

  return (
    <Sheet
      open
      side="full"
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title="Take payment"
      description={[`Order ${order.orderNumber}`, serviceTypeWords(order.serviceType), orderPlaceWords(order.serviceType, order.tableLabel)]
        .filter(Boolean)
        .join(" · ")}
      footer={
        // The action stays in the sheet's footer, on screen at every size; the methods scroll above it.
        <div className="y-pay__footer">
          <Button variant="quiet" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          {unsure ? (
            <Button variant="primary" size={64} data-testid="pay-check" disabled={unsure.checking} onClick={onCheck}>
              {unsure.checking ? "Checking with Yetu…" : "Check with Yetu"}
            </Button>
          ) : method === "CASH" ? (
            <Button
              type="submit"
              form={CASH_FORM}
              variant="primary"
              size={64}
              data-testid="confirm-settle"
              disabled={cashTaken == null || pending}
            >
              {pending ? "Recording…" : cashTaken == null ? "Take cash" : `Take ${formatMoney(cashTaken, currency)} cash`}
            </Button>
          ) : method === "ROOM_CHARGE" ? (
            <Button
              variant="primary"
              size={64}
              data-testid="confirm-room-charge"
              disabled={nothingDue || !chosenStay || chosenStay.postingEligible === false || roomBlocked !== null || pending}
              onClick={() => chosenStay && onChargeRoom(chosenStay)}
            >
              {pending
                ? "Charging…"
                : chosenStay
                  ? `Charge ${formatMoney(due, currency)} to room ${chosenStay.roomNumber}`
                  : "Charge to room"}
            </Button>
          ) : (
            <Button
              type="submit"
              form={RECORDED_FORM}
              variant="primary"
              size={64}
              data-testid="confirm-settle"
              disabled={nothingDue || amount == null || amount <= 0 || over || pending}
            >
              {pending ? "Recording…" : `Confirm ${formatMoney(amount, currency)} received`}
            </Button>
          )}
        </div>
      }
      testId="settle-dialog"
    >
      <div className="y-pay">
        <section className="y-pay__left" aria-label="What is owed">
          <p className="y-pay__label">{partPaid ? "Still to pay" : "Amount due"}</p>
          <Money minor={due} currency={currency} size="display" data-testid="amount-due" />
          {partPaid ? (
            <div className="y-pay__progress">
              <div
                role="progressbar"
                aria-label={`Paid ${formatMoney(order.paidMinor, currency)} of ${formatMoney(order.totalMinor, currency)}`}
                aria-valuemin={0}
                aria-valuemax={order.totalMinor}
                aria-valuenow={order.paidMinor}
                className="y-pay__bar"
              >
                <span style={{ width: `${Math.min(100, (order.paidMinor / Math.max(1, order.totalMinor)) * 100)}%` }} />
              </div>
              <p className="y-pay__paid" data-testid="amount-paid">
                Paid {formatMoney(order.paidMinor, currency)} of {formatMoney(order.totalMinor, currency)}
              </p>
            </div>
          ) : null}
          <div role="radiogroup" aria-label="How the guest pays" className="y-pay__methods" onKeyDown={onMethodKey}>
            {methods.map((candidate, index) => (
              <button
                key={candidate}
                ref={(element) => {
                  methodRefs.current[index] = element;
                }}
                type="button"
                role="radio"
                aria-checked={method === candidate}
                tabIndex={method === candidate ? 0 : -1}
                disabled={!usable(candidate) || pending}
                data-testid={`method-${candidate}`}
                className="y-pay__method"
                onClick={() => chooseMethod(candidate, true)}
              >
                {paymentMethodWords(candidate)}
              </button>
            ))}
          </div>
          {roomAvailable && roomBlocked && !nothingDue ? <p className="y-pay__note">{roomBlocked}</p> : null}
        </section>

        <section className="y-pay__right" aria-label={paymentMethodWords(method)}>
          <div ref={paneRef} className="y-pay__pane-wrap">
          {method === "CASH" ? (
            <form
              id={CASH_FORM}
              className="y-pay__pane"
              onSubmit={(event) => {
                event.preventDefault();
                takeCash();
              }}
            >
              {nothingDue ? null : (
                <QuickCash dueMinor={due} currency={currency} onPick={(minor) => setReceived(moneyFieldText(minor))} />
              )}
              <MoneyField
                label="Cash received"
                currency={currency}
                value={received}
                onValueChange={(text) => setReceived(text)}
                inputTestId="amount-received"
              />
              <Keypad label="Cash received" variant="money" onKey={onCashKey} testIdPrefix="cash-key" />
              <p className="y-pay__change" data-testid="change-due" aria-live="polite">
                {nothingDue
                  ? "Nothing left to pay."
                  : receivedMinor == null || receivedMinor <= 0
                  ? "Type or pick the cash the guest gives you."
                  : receivedMinor >= due
                    ? `Change to give ${formatMoney(receivedMinor - due, currency)}`
                    : `Part payment: ${formatMoney(receivedMinor, currency)} now, ${formatMoney(due - receivedMinor, currency)} still to pay`}
              </p>
            </form>
          ) : method === "ROOM_CHARGE" ? (
            <div className="y-pay__pane">
              <SearchField
                label="Room or guest name"
                placeholder="Room number or guest name"
                value={roomQuery}
                onChange={(text) => {
                  onRoomQuery(text);
                  setStayId(null);
                }}
                size={56}
                inputProps={{ "data-testid": "room-query" } as Record<string, unknown>}
              />
              <div className="y-pay__rooms" aria-label="Guests staying">
                {!searched ? (
                  <p className="y-pay__note">Type a room number or a guest's name.</p>
                ) : searching && candidates.length === 0 ? (
                  <p className="y-pay__note">Looking…</p>
                ) : candidates.length === 0 ? (
                  <p className="y-pay__note" data-testid="room-candidates-empty">
                    No guest staying matches.
                  </p>
                ) : (
                  candidates.map((candidate) => {
                    const eligible = candidate.postingEligible !== false;
                    return (
                      <button
                        key={candidate.stayId}
                        type="button"
                        data-testid={`room-candidate-${candidate.stayId}`}
                        aria-pressed={candidate.stayId === stayId}
                        disabled={!eligible || pending}
                        className="y-pay__room"
                        onClick={() => setStayId(candidate.stayId)}
                      >
                        <span className="y-pay__room-name">
                          Room {candidate.roomNumber} · {candidate.guestDisplayName}
                        </span>
                        {!eligible ? <span className="y-pay__room-why">Bill not open. Ask the front desk.</span> : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <form
              id={RECORDED_FORM}
              className="y-pay__pane"
              onSubmit={(event) => {
                event.preventDefault();
                confirmRecorded();
              }}
            >
              <p className="y-pay__step">{RECORDED_STEP[method]}</p>
              <MoneyField
                label="Amount"
                hint={`Leave it empty to take the full ${formatMoney(due, currency)}. Type less to split the payment.`}
                currency={currency}
                value={amountText}
                onValueChange={(text) => setAmountText(text)}
                inputTestId="tender-amount"
                error={over ? `That's more than the ${formatMoney(due, currency)} still to pay.` : undefined}
              />
              <Field
                label="Reference (optional)"
                hint="A transaction number or a phone number, if there is one."
                value={reference}
                onChange={setReference}
                autoComplete="off"
                data-testid="tender-reference"
              />
            </form>
          )}
          </div>
          <p className="y-pay__recorded" role="status" data-testid="tender-recorded">
            {recordedMinor != null && due > 0
              ? `Recorded ${formatMoney(recordedMinor, currency)}. ${formatMoney(due, currency)} still to pay.`
              : ""}
          </p>
          {unsure ? (
            <Banner inline tone="danger" data-testid="pay-unsure">
              {`The connection dropped while Yetu was recording this ${unsure.room ? "charge" : "payment"}. We don't know yet if it went through. `}
              {unsure.checking
                ? "Checking with Yetu…"
                : unsure.failed
                  ? `Still can't reach Yetu. Don't ${unsure.room ? "charge the room" : "take the money"} again until Yetu answers.`
                  : ""}
            </Banner>
          ) : null}
          {problem ? <RefusalNotice refusal={problem} data-testid="settle-error" /> : null}
        </section>
      </div>
    </Sheet>
  );
}
