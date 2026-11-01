import { useHasPermission, useOutletMoneySettings } from "../hooks/usePosData";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { moneyFieldText } from "../cash/NoteCounterSheet";
import { EXACT_WORDS, ignoreHeldEnter, startAmount, useFilledAmount } from "./moneyEntry";
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
import type { PaymentMethod, POSOrder, POSPaymentChannel, POSRoomChargeCandidate } from "../lib/posContracts";
import { toMinor } from "../lib/posMoney";
import { orderPlaceWords, paymentMethodWords, serviceTypeWords, type SettlementMethod } from "../lib/words";
import { afterLostAnswer, firstAnswerLost, lostAnswerRefusalWords, roomChargeProblem, tenderProblem } from "./registerWords";
import { PAY_CHECK_EVERY_SECONDS } from "./registerSettings";
import { orderName } from "../lib/orderNumber";
import { openDrawerForCash } from "../print/cashDrawer";
import { drawerNotOpenedWords } from "../print/printProblems";

const CASH_FORM = "pay-cash";
const RECORDED_FORM = "pay-recorded";

/** Named setting: how long the room search waits after typing before it asks Yetu. */
export const ROOM_SEARCH_WAIT_MS = 250;


/**
 * A payment or room charge whose answer was lost: the request itself (its
 * key, version and body), sent again as it is until Yetu answers for it.
 */
type Lost =
  | { kind: "tender"; vars: TenderVars; request: TenderRequest; before: POSOrder; failed: boolean }
  | { kind: "room"; vars: RoomChargeVars; candidate: POSRoomChargeCandidate; failed: boolean };

type TenderVars = {
  orderId: string;
  paymentMethod: PaymentMethod;
  paymentChannelId?: string;
  amountMinor: number;
  reference?: string;
  version: number;
  idempotencyKey: string;
};
type RoomChargeVars = { orderId: string; stayId: string; idempotencyKey: string };

/** The tenders Yetu takes (posContracts PaymentMethod), in this order. */
export const TENDER_METHODS: readonly PaymentMethod[] = ["CASH", "MOBILE_MONEY", "EXTERNAL_CARD", "BANK_TRANSFER", "OTHER"];

type Method = PaymentMethod | "ROOM_CHARGE";

/** One button on the sheet: a way of paying, by the business's own name when it has one. */
export interface TenderOption {
  key: string;
  method: Method;
  channel?: POSPaymentChannel;
}

/**
 * What the sheet offers: cash first, then the business's own ways of paying in
 * its order, then any plain method none of them stands for (a named M-Pesa
 * replaces plain Mobile money; Card stays until a card channel is named), and
 * the room last.
 */
export function tenderOptions(channels: readonly POSPaymentChannel[], roomAvailable: boolean): TenderOption[] {
  const covered = new Set<PaymentMethod>(channels.map((channel) => channel.paymentMethod));
  return [
    { key: "CASH", method: "CASH" },
    ...channels.map((channel): TenderOption => ({ key: `channel-${channel.id}`, method: channel.paymentMethod, channel })),
    ...TENDER_METHODS.filter((method) => method !== "CASH" && !covered.has(method)).map((method): TenderOption => ({ key: method, method })),
    ...(roomAvailable ? [{ key: "ROOM_CHARGE", method: "ROOM_CHARGE" } as TenderOption] : []),
  ];
}

const optionWords = (option: TenderOption) => option.channel?.name ?? paymentMethodWords(option.method);

/** What a recorded way of paying asks the person to check first. */
function recordedStep(option: TenderOption): string {
  if (option.method === "CASH" || option.method === "ROOM_CHARGE") return "";
  if (option.channel) {
    const where = option.channel.payTo ?? (option.method === "BANK_TRANSFER" ? "the account" : `your ${option.channel.name} number`);
    return option.method === "EXTERNAL_CARD" ? RECORDED_STEP.EXTERNAL_CARD : `Check the money has reached ${where}, then confirm here.`;
  }
  return RECORDED_STEP[option.method];
}

/** What a recorded (not processed) method asks the person to do first. */
const RECORDED_STEP: Record<Exclude<PaymentMethod, "CASH">, string> = {
  // F-236: mobile money is paid to the outlet's number, not taken on a machine.
  MOBILE_MONEY: "Check the money has reached your mobile money number, then confirm here.",
  EXTERNAL_CARD: "Take payment on your own machine, then confirm here.",
  BANK_TRANSFER: "Check the transfer has reached the account, then confirm here.",
  OTHER: "Write how it was paid in the reference, then confirm here.",
};

export interface PaidInfo {
  order: POSOrder;
  method: SettlementMethod;
  /** The business's own name for the way of paying, when it was one of theirs. */
  channelName?: string;
  /** Change given for the last cash tender: the cash received less what was owed. */
  changeMinor: number;
  roomNumber?: string;
  /** Part of it was paid before this last tender. */
  split?: boolean;
}

export interface TenderRequest {
  method: PaymentMethod;
  /** One of the business's ways of paying, when the person tapped one. */
  channelId?: string;
  /** Its name, for what is said back once it is paid. */
  channelName?: string;
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
  onDrawerProblem,
}: {
  order: POSOrder;
  currency: string;
  onClose: () => void;
  onOrderChange?: (order: POSOrder) => void;
  onPaid: (paid: PaidInfo) => void;
  /** The drawer didn't open for cash: said here, and by the page once the sheet has closed. */
  onDrawerProblem?: (words: string) => void;
}) {
  const moneySettings = useOutletMoneySettings();
  // A waiter keeps the cash they take until they hand it in (fbc-peak #327): no drawer for them.
  const holdsDrawer = useHasPermission("pos.cash_drawer.open");
  const [live, setLive] = useState(order);
  const [drawerProblem, setDrawerProblem] = useState<string | null>(null);
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

  // A payment whose answer was lost. Its fate is decided only by Yetu's answer to the same
  // request (same key, version and body): never from the order's own figures.
  const [lost, setLostState] = useState<Lost | null>(null);
  const lostRef = useRef<Lost | null>(null);
  const setLost = (next: Lost | null) => {
    lostRef.current = next;
    setLostState(next);
  };
  // What Yetu said for a request after its first answer was lost, when it wasn't recorded or can't be told.
  const [answer, setAnswer] = useState<{ words: string; final: boolean } | null>(null);

  /** Yetu refused the request after its answer was lost: show its latest, claim nothing for this till. */
  function refusedAfterLost(error: unknown, room: boolean) {
    setLost(null);
    // Whatever Yetu's latest turns out to be (or if it can't be read), the next payment is a new request.
    lastTender.current = null;
    lastRoomCharge.current = null;
    const final = afterLostAnswer(error) === "cannot-tell";
    setAnswer({ words: lostAnswerRefusalWords(error, room), final });
    if (!final) void latestOrder.refetch().then((result) => result.status === "success" && adopt(result.data));
  }

  // A request is with Yetu and hasn't answered: it is never sent again on top of itself.
  const inFlight = useRef(false);

  function sendTender(vars: TenderVars, request: TenderRequest, before: POSOrder) {
    inFlight.current = true;
    recordTender.mutate(vars, {
      onSuccess: (updated) => {
        inFlight.current = false;
        // Yetu's answer to this request (recorded now, or replayed): this till's tender, exactly once.
        setLost(null);
        setAnswer(null);
        setLive(updated);
        setRecorded(request.amountMinor);
        onOrderChange?.(updated);
        // Every cash payment opens the drawer, part or whole (2026-10-21): change comes from the drawer.
        // A waiter has no drawer: they keep the cash and give change from it (fbc-peak #327).
        setDrawerProblem(null);
        if (holdsDrawer) {
          void openDrawerForCash(request.method).then((result) => {
            if (result.ok) return;
            const words = drawerNotOpenedWords(result.error ?? "");
            setDrawerProblem(words);
            onDrawerProblem?.(words);
          });
        }
        if ((updated.remainingMinor ?? 0) <= 0 || updated.status === "CLOSED") {
          // Split: paid more than one way (F-269); two cash payments are cash.
          const methods = new Set([...(updated.payments ?? []).map((payment) => payment.paymentMethod), request.method]);
          onPaid({ order: updated, method: request.method, channelName: request.channelName, changeMinor: request.changeMinor, split: methods.size > 1 });
        }
      },
      onError: (error) => {
        inFlight.current = false;
        const wasLost = lostRef.current !== null;
        // The first answer: lost only when it is no answer; a replay: unsure unless it proves "not recorded".
        if (wasLost ? afterLostAnswer(error) === "unsure" : firstAnswerLost(error)) {
          setLost({ kind: "tender", vars, request, before, failed: wasLost });
          return;
        }
        if (wasLost) {
          refusedAfterLost(error, false);
          return;
        }
        if (tenderProblem(error)?.kind === "stale") void latestOrder.refetch().then((result) => adopt(result.data));
      },
    });
  }

  function sendRoomCharge(vars: RoomChargeVars, candidate: POSRoomChargeCandidate) {
    inFlight.current = true;
    chargeToRoom.mutate(vars, {
      onSuccess: (updated) => {
        inFlight.current = false;
        setLost(null);
        setAnswer(null);
        onPaid({ order: updated, method: "ROOM_CHARGE", changeMinor: 0, roomNumber: candidate.roomNumber });
      },
      onError: (error) => {
        inFlight.current = false;
        const wasLost = lostRef.current !== null;
        if (wasLost ? afterLostAnswer(error) === "unsure" : firstAnswerLost(error)) {
          setLost({ kind: "room", vars, candidate, failed: wasLost });
          return;
        }
        if (wasLost) refusedAfterLost(error, true);
      },
    });
  }

  /** Send the lost request again, as it was, unless it is already with Yetu. */
  function askAgain() {
    const current = lostRef.current;
    if (!current || inFlight.current) return;
    if (current.kind === "tender") sendTender(current.vars, current.request, current.before);
    else sendRoomCharge(current.vars, current.candidate);
  }

  const isLost = lost !== null;
  const askAgainRef = useRef(askAgain);
  askAgainRef.current = askAgain;
  useEffect(() => {
    if (!isLost) return;
    askAgainRef.current();
    const id = setInterval(() => askAgainRef.current(), PAY_CHECK_EVERY_SECONDS * 1000);
    return () => clearInterval(id);
  }, [isLost]);

  const problem = isLost
    ? null
    : answer
      ? { kind: "other", words: answer.words }
      : (tenderProblem(recordTender.error) ?? roomChargeProblem(chargeToRoom.error));
  // The till doesn't lock itself while a payment is with Yetu or its answer is lost (the hold is bounded).
  useHoldIdleLock(recordTender.isPending || chargeToRoom.isPending || isLost);

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
      unsure={lost ? { failed: lost.failed, checking: recordTender.isPending || chargeToRoom.isPending, room: lost.kind === "room" } : null}
      onCheck={askAgain}
      blocked={answer?.final ?? false}
      problem={problem ?? null}
      recordedMinor={recorded}
      drawerProblem={drawerProblem}
      quickCashNotes={moneySettings.quickCashNotes}
        channels={moneySettings.paymentChannels}
      onClose={onClose}
      onTender={(request) => {
        setAnswer(null);
        sendTender(
          {
            orderId: live.id,
            paymentMethod: request.method,
            paymentChannelId: request.channelId,
            amountMinor: request.amountMinor,
            reference: request.reference,
            version: live.version,
            idempotencyKey: keyFor(
              lastTender,
              [request.method, request.channelId ?? "", request.amountMinor, request.reference ?? "", live.version].join("|"),
              tenderKey.next,
            ),
          },
          request,
          live,
        );
      }}
      onChargeRoom={(candidate) => {
        setAnswer(null);
        sendRoomCharge(
          {
            orderId: live.id,
            stayId: candidate.stayId,
            idempotencyKey: keyFor(lastRoomCharge, [candidate.stayId, live.version].join("|"), roomChargeKey.next),
          },
          candidate,
        );
      }}
    />
  );
}

export interface PaySheetViewProps {
  quickCashNotes?: readonly number[];
  /** The business's own ways of paying. None: the plain methods. */
  channels?: readonly POSPaymentChannel[];
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
  /** Yetu couldn't answer for a lost payment here (the session ended): no payment is offered. */
  blocked?: boolean;
  /** Why Yetu refused the payment: a 403 shows as a permission notice. */
  problem: Refusal | string | null;
  /** The last part payment Yetu recorded on this order, if any. */
  recordedMinor?: number | null;
  /** The drawer didn't open for the cash just taken. */
  drawerProblem?: string | null;
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
  blocked = false,
  problem,
  recordedMinor = null,
  drawerProblem = null,
  onClose,
  onTender,
  onChargeRoom,
  initialMethod = "CASH",
  channels = [],
  quickCashNotes,
  initialReceived = "",
  initialStayId,
}: PaySheetViewProps) {
  const [chosenKey, setChosenKey] = useState<string>(initialMethod);
  const options = useMemo(() => tenderOptions(channels, roomAvailable), [channels, roomAvailable]);
  // A way of paying retired while the sheet is open falls back to cash.
  const chosen = options.find((option) => option.key === chosenKey) ?? options[0];
  const method = chosen.method;
  // While what Yetu recorded is unknown, nothing new is taken and the sheet stays.
  const pending = requestPending || unsure !== null;
  // Where the amount is known it is filled in (owner, 2026-10-21;
  // register.fillAmountDue): the cash received and a card or mobile amount
  // start at what is owed, so exact money is one tap, and the first key the
  // cashier types replaces it.
  const cash = useFilledAmount(startAmount(order.remainingMinor, initialReceived));
  const other = useFilledAmount(startAmount(order.remainingMinor));
  const received = cash.text;
  const amountText = other.text;
  const [reference, setReference] = useState("");
  const [stayId, setStayId] = useState<string | null>(initialStayId ?? null);
  const methodRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const paneRef = useRef<HTMLDivElement>(null);
  // Focus moves into a method's field when the sheet opens and when a method
  // is pressed (click or Enter), never when the arrow keys move between methods.
  const focusPane = useRef(true);

  // Each payment Yetu records gives the order a new version and more paid:
  // what was typed for it is cleared, and the cash stays empty, so a second
  // tap can't record the rest unasked. Any other change (the kitchen, another
  // till) keeps what the cashier typed; an amount still filled in follows
  // what is owed.
  const [seenVersion, setSeenVersion] = useState(order.version);
  const [seenPaid, setSeenPaid] = useState(order.paidMinor);
  if (order.version !== seenVersion) {
    setSeenVersion(order.version);
    if (order.paidMinor !== seenPaid) {
      setSeenPaid(order.paidMinor);
      cash.clear();
      other.fill(order.remainingMinor);
      setReference("");
      setStayId(null);
    } else {
      if (cash.filled) cash.fill(order.remainingMinor);
      if (other.filled) other.fill(order.remainingMinor);
    }
  }

  const due = order.remainingMinor;
  const nothingDue = due <= 0;
  const partPaid = order.paidMinor > 0;
  // Yetu charges a room for an order the kitchen has, preparing or after (F-245): all of it, or
  // what is left once part is paid (F-244).
  const roomBlocked = order.status === "OPEN" ? "Charge to room: send it to the kitchen first." : null;
  const usable = (candidate: Method) => !blocked && !nothingDue && !(candidate === "ROOM_CHARGE" && roomBlocked !== null);

  // Prices below are Yetu's (what is owed); the change and a part payment's
  // remainder are worked out from the cash the person types, in whole minor units.
  const receivedMinor = toMinor(received);
  const cashTaken = !nothingDue && receivedMinor != null && receivedMinor > 0 ? Math.min(receivedMinor, due) : null;
  // An empty amount is no amount: nothing is confirmed from an empty field.
  const amount = amountText.trim() ? toMinor(amountText) : null;
  const over = amount != null && amount > due;
  const chosenStay = candidates.find((candidate) => candidate.stayId === stayId) ?? null;

  function chooseMethod(next: TenderOption, pressed: boolean) {
    focusPane.current = pressed;
    setChosenKey(next.key);
    other.fill(due);
    setReference("");
    // Room service already says which room: the search starts there (F-239).
    if (next.method === "ROOM_CHARGE" && !roomQuery.trim() && order.serviceType === "ROOM_SERVICE" && order.tableLabel?.trim()) {
      onRoomQuery(order.tableLabel.trim());
    }
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
    const open = options.filter((option) => usable(option.method));
    const index = open.findIndex((option) => option.key === chosen.key);
    const next = open[(index + (forward ? 1 : -1) + open.length) % open.length];
    chooseMethod(next, false);
    methodRefs.current[options.findIndex((option) => option.key === next.key)]?.focus();
  }

  function onCashKey(key: KeypadKey) {
    cash.keyed(key);
  }

  function takeCash() {
    // Enter in the cash field submits too: nothing new while an answer is lost or Yetu can't tell.
    if (receivedMinor == null || cashTaken == null || pending || blocked) return;
    onTender({ method: "CASH", amountMinor: cashTaken, changeMinor: Math.max(0, receivedMinor - due) });
  }

  function confirmRecorded() {
    if (method === "CASH" || method === "ROOM_CHARGE" || nothingDue || amount == null || amount <= 0 || over || pending || blocked) return;
    onTender({ method, channelId: chosen.channel?.id, channelName: chosen.channel?.name, amountMinor: amount, reference: reference.trim() || undefined, changeMinor: 0 });
  }

  return (
    <Sheet
      open
      side="full"
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title="Take payment"
      description={[orderName(order), serviceTypeWords(order.serviceType), orderPlaceWords(order.serviceType, order.tableLabel)]
        .filter(Boolean)
        .join(" · ")}
      footer={
        // The action stays in the sheet's footer, on screen at every size; the methods scroll above it.
        <div className="y-pay__footer">
          {/* "Back", not "Cancel": on a till Cancel means taking an order off (owner, 2026-10-21). */}
          <Button variant="quiet" disabled={pending} onClick={onClose}>
            Back
          </Button>
          {unsure ? (
            <Button variant="primary" size={64} data-testid="pay-check" disabled={unsure.checking} onClick={onCheck}>
              {unsure.checking ? "Asking Yetu…" : "Ask Yetu again"}
            </Button>
          ) : blocked ? null : method === "CASH" ? (
            <Button
              type="submit"
              form={CASH_FORM}
              variant="pay"
              size={64}
              data-testid="confirm-settle"
              disabled={cashTaken == null || pending}
            >
              {pending ? "Recording…" : cashTaken == null ? "Take cash" : `Take ${formatMoney(cashTaken, currency)} cash`}
            </Button>
          ) : method === "ROOM_CHARGE" ? (
            <Button
              variant="pay"
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
              variant="pay"
              size={64}
              data-testid="confirm-settle"
              disabled={nothingDue || amount == null || amount <= 0 || over || pending}
            >
              {pending ? "Recording…" : amount != null ? `Confirm ${formatMoney(amount, currency)} received` : "Type the amount"}
            </Button>
          )}
        </div>
      }
      testId="settle-dialog"
    >
      <div className="y-pay">
        <section className="y-pay__left" aria-label="What is owed">
          <p className="y-pay__label">{partPaid ? "Still to pay" : "To pay"}</p>
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
            {options.map((candidate, index) => (
              <button
                key={candidate.key}
                ref={(element) => {
                  methodRefs.current[index] = element;
                }}
                type="button"
                role="radio"
                aria-checked={chosen.key === candidate.key}
                tabIndex={chosen.key === candidate.key ? 0 : -1}
                disabled={!usable(candidate.method) || pending}
                data-testid={`method-${candidate.key}`}
                className="y-pay__method"
                onClick={() => chooseMethod(candidate, true)}
              >
                {optionWords(candidate)}
              </button>
            ))}
          </div>
          {roomAvailable && roomBlocked && !nothingDue ? <p className="y-pay__note">{roomBlocked}</p> : null}
          {/* Cash: the change under what is owed, where the cashier reads the figures; the keypad stays on the right. */}
          {method === "CASH" ? (
              <p className="y-pay__change" data-testid="change-due" aria-live="polite">
                {nothingDue
                  ? "Nothing left to pay."
                  : receivedMinor == null || receivedMinor <= 0
                  ? "Type or pick the cash the guest gives you."
                  : receivedMinor === due
                  ? EXACT_WORDS
                  : receivedMinor > due
                    ? (
                        <span className="y-pay__change-due">
                          <span>Change to give</span>{" "}
                          <strong>{formatMoney(receivedMinor - due, currency)}</strong>
                        </span>
                      )
                    : `Part payment: ${formatMoney(receivedMinor, currency)} now, ${formatMoney(due - receivedMinor, currency)} still to pay`}
              </p>
          ) : null}
        </section>

        <section className="y-pay__right" aria-label={optionWords(chosen)}>
          <div ref={paneRef} className="y-pay__pane-wrap">
          {method === "CASH" ? (
            <form
              id={CASH_FORM}
              className="y-pay__pane"
              onKeyDown={ignoreHeldEnter}
              onSubmit={(event) => {
                event.preventDefault();
                takeCash();
              }}
            >
              {nothingDue ? null : (
                <QuickCash dueMinor={due} notes={quickCashNotes} currency={currency} onPick={(minor) => cash.picked(moneyFieldText(minor))} />
              )}
              <MoneyField
                label="Cash received"
                currency={currency}
                value={received}
                selectOnFocus
                onValueChange={(text, _minor, edit) => cash.typed(text, edit)}
                inputTestId="amount-received"
              />
              <Keypad label="Cash received" variant="money" onKey={onCashKey} testIdPrefix="cash-key" />
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
              onKeyDown={ignoreHeldEnter}
              onSubmit={(event) => {
                event.preventDefault();
                confirmRecorded();
              }}
            >
              <p className="y-pay__step">{recordedStep(chosen)}</p>
              <MoneyField
                label="Amount"
                hint="Less than the bill? The rest stays to pay."
                currency={currency}
                value={amountText}
                selectOnFocus
                onValueChange={(text, _minor, edit) => other.typed(text, edit)}
                inputTestId="tender-amount"
                error={over ? `That's more than the ${formatMoney(due, currency)} still to pay.` : undefined}
              />
              <Keypad label="Amount" variant="money" onKey={(key) => other.keyed(key)} testIdPrefix="tender-key" />
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
          {drawerProblem ? (
            <p className="y-pay__recorded" role="alert" data-testid="pay-drawer-problem">
              {drawerProblem}
            </p>
          ) : null}
          {unsure ? (
            <Banner inline tone="danger" data-testid="pay-unsure">
              {`The connection dropped while Yetu was recording this ${unsure.room ? "charge" : "payment"}. We don't know yet if it went through. `}
              {unsure.checking
                ? "Checking…"
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
