import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { moneyFieldText } from "../cash/NoteCounterSheet";
import { Banner, Button, Field, Keypad, Money, MoneyField, QuickCash, SearchField, Sheet, type KeypadKey } from "../components/system";
import {
  useChargeToRoom,
  useIdempotencyKey,
  useRecordTender,
  useRoomChargeAvailability,
  useRoomChargeCandidates,
} from "../hooks/usePosData";
import { formatMoney } from "../lib/money";
import type { PaymentMethod, POSOrder, POSRoomChargeCandidate } from "../lib/posContracts";
import { toMinor } from "../lib/posMoney";
import { orderPlaceWords, paymentMethodWords, serviceTypeWords, type SettlementMethod } from "../lib/words";
import { roomChargeProblem, tenderProblem } from "./registerWords";

/** Named setting: how long the room search waits after typing before it asks Yetu. */
export const ROOM_SEARCH_WAIT_MS = 250;

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
  const roomAvailable = useRoomChargeAvailability().data === true;
  const candidates = useRoomChargeCandidates(needle);

  useEffect(() => setLive(order), [order]);
  useEffect(() => {
    const wait = setTimeout(() => setNeedle(roomQuery.trim()), ROOM_SEARCH_WAIT_MS);
    return () => clearTimeout(wait);
  }, [roomQuery]);

  const problem = tenderProblem(recordTender.error) ?? roomChargeProblem(chargeToRoom.error);

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
      problem={problem?.words ?? null}
      recordedMinor={recorded}
      onClose={onClose}
      onTender={(request) =>
        recordTender.mutate(
          {
            orderId: live.id,
            paymentMethod: request.method,
            amountMinor: request.amountMinor,
            reference: request.reference,
            version: live.version,
            idempotencyKey: tenderKey.next(),
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
          },
        )
      }
      onChargeRoom={(candidate) =>
        chargeToRoom.mutate(
          { orderId: live.id, stayId: candidate.stayId, idempotencyKey: roomChargeKey.current },
          {
            onSuccess: (updated) =>
              onPaid({ order: updated, method: "ROOM_CHARGE", changeMinor: 0, roomNumber: candidate.roomNumber }),
          },
        )
      }
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
  problem: string | null;
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
  pending,
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
  const [received, setReceived] = useState(initialReceived);
  const [amountText, setAmountText] = useState("");
  const [reference, setReference] = useState("");
  const [stayId, setStayId] = useState<string | null>(initialStayId ?? null);
  const methodRefs = useRef<Array<HTMLButtonElement | null>>([]);

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
  const usable = (candidate: Method) => !nothingDue && !(candidate === "ROOM_CHARGE" && partPaid);

  // Prices below are Yetu's (what is owed); the change and a part payment's
  // remainder are worked out from the cash the person types, in whole minor units.
  const receivedMinor = toMinor(received);
  const cashTaken = !nothingDue && receivedMinor != null && receivedMinor > 0 ? Math.min(receivedMinor, due) : null;
  const amount = amountText.trim() ? toMinor(amountText) : due;
  const over = amount != null && amount > due;
  const chosenStay = candidates.find((candidate) => candidate.stayId === stayId) ?? null;

  function chooseMethod(next: Method) {
    setMethod(next);
    setAmountText("");
    setReference("");
  }

  function onMethodKey(event: KeyboardEvent<HTMLDivElement>) {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !back) return;
    event.preventDefault();
    const open = methods.filter(usable);
    const index = open.indexOf(method);
    const next = open[(index + (forward ? 1 : -1) + open.length) % open.length];
    chooseMethod(next);
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
                onClick={() => chooseMethod(candidate)}
              >
                {paymentMethodWords(candidate)}
              </button>
            ))}
          </div>
          {roomAvailable && partPaid ? (
            <p className="y-pay__note">Charge to room isn't possible once part of the bill is paid.</p>
          ) : null}
        </section>

        <section className="y-pay__right" aria-label={paymentMethodWords(method)}>
          {method === "CASH" ? (
            <form
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
                autoFocus
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
              <Button type="submit" variant="primary" size={64} block data-testid="confirm-settle" disabled={cashTaken == null || pending}>
                {pending ? "Recording…" : cashTaken == null ? "Take cash" : `Take ${formatMoney(cashTaken, currency)} cash`}
              </Button>
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
                inputProps={{ "data-testid": "room-query", autoFocus: true } as Record<string, unknown>}
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
              <Button
                variant="primary"
                size={64}
                block
                data-testid="confirm-room-charge"
                disabled={nothingDue || !chosenStay || chosenStay.postingEligible === false || partPaid || pending}
                onClick={() => chosenStay && onChargeRoom(chosenStay)}
              >
                {pending
                  ? "Charging…"
                  : chosenStay
                    ? `Charge ${formatMoney(due, currency)} to room ${chosenStay.roomNumber}`
                    : "Charge to room"}
              </Button>
            </div>
          ) : (
            <form
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
              <Button
                type="submit"
                variant="primary"
                size={64}
                block
                data-testid="confirm-settle"
                disabled={nothingDue || amount == null || amount <= 0 || over || pending}
              >
                {pending ? "Recording…" : `Confirm ${formatMoney(amount, currency)} received`}
              </Button>
            </form>
          )}
          <p className="y-pay__recorded" role="status" data-testid="tender-recorded">
            {recordedMinor != null && due > 0
              ? `Recorded ${formatMoney(recordedMinor, currency)}. ${formatMoney(due, currency)} still to pay.`
              : ""}
          </p>
          {problem ? (
            <Banner inline tone="danger" data-testid="settle-error">
              {problem}
            </Banner>
          ) : null}
        </section>
      </div>
    </Sheet>
  );
}
