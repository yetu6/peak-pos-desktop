import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { formatMinor, toMinor } from "../lib/posMoney";
import {
  useChargeToRoom,
  useIdempotencyKey,
  useMutationMessage,
  useRecordTender,
  useRoomChargeAvailability,
  useRoomChargeCandidates,
} from "../hooks/usePosData";
import type { PaymentMethod, POSOrder, POSRoomChargeCandidate } from "../lib/posContracts";

/**
 * Peak tender contract: one `paymentMethod` from
 * CASH/MOBILE_MONEY/BANK_TRANSFER/EXTERNAL_CARD/OTHER against the remaining
 * balance. Partial tenders leave the order open until remaining is zero
 * (split pay). Non-cash methods record an external settlement — Peak never
 * processes a PSP.
 */
const METHODS: Array<{ id: PaymentMethod; label: string; helper?: string }> = [
  { id: "CASH", label: "Cash" },
  { id: "MOBILE_MONEY", label: "Mobile money", helper: "Records an external mobile money payment" },
  { id: "BANK_TRANSFER", label: "Bank transfer", helper: "Records an external bank transfer" },
  { id: "EXTERNAL_CARD", label: "Card", helper: "Records an external card payment" },
  { id: "OTHER", label: "Other" },
];

const SEARCH_DEBOUNCE_MS = 250;

function remainingOf(order: POSOrder): number {
  return order.remainingMinor ?? Math.max(0, order.totalMinor - (order.paidMinor ?? 0));
}

export function SettleDialog({
  order,
  currency,
  onClose,
  onSettled,
  onOrderChange,
}: {
  order: POSOrder;
  currency: string;
  onClose: () => void;
  onSettled: (orderId: string) => void;
  onOrderChange?: (order: POSOrder) => void;
}) {
  const [liveOrder, setLiveOrder] = useState(order);
  const [tab, setTab] = useState<"tender" | "room">("tender");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
  const [tenderAmount, setTenderAmount] = useState("");
  const [roomQuery, setRoomQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState<POSRoomChargeCandidate | null>(null);

  const recordTender = useRecordTender();
  const chargeToRoom = useChargeToRoom();
  const tenderKey = useIdempotencyKey();
  const roomChargeKey = useIdempotencyKey();
  const roomChargeAvailable = useRoomChargeAvailability();
  const candidates = useRoomChargeCandidates(debouncedQuery);
  const tenderError = useMutationMessage(recordTender.error);
  const roomChargeError = useMutationMessage(chargeToRoom.error);

  const dueMinor = remainingOf(liveOrder);
  const paidMinor = liveOrder.paidMinor ?? 0;

  useEffect(() => {
    setLiveOrder(order);
  }, [order]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(roomQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [roomQuery]);

  const receivedMinor = toMinor(amountReceived);
  const explicitTenderMinor = toMinor(tenderAmount);
  const applyMinor =
    method === "CASH"
      ? Math.min(receivedMinor ?? 0, dueMinor)
      : explicitTenderMinor ?? dueMinor;

  const changeDueMinor =
    method === "CASH" && receivedMinor != null ? Math.max(0, receivedMinor - dueMinor) : null;

  const canSubmitTender = useMemo(() => {
    if (recordTender.isPending || dueMinor <= 0) return false;
    if (method === "CASH") return receivedMinor != null && receivedMinor > 0 && applyMinor > 0;
    return reference.trim().length > 0 && applyMinor > 0 && applyMinor <= dueMinor;
  }, [method, receivedMinor, applyMinor, dueMinor, reference, recordTender.isPending]);

  const canSubmitRoomCharge =
    selected != null &&
    selected.postingEligible !== false &&
    !chargeToRoom.isPending &&
    paidMinor === 0;

  function submitTender(): void {
    if (applyMinor <= 0) return;
    recordTender.mutate(
      {
        orderId: liveOrder.id,
        paymentMethod: method,
        amountMinor: applyMinor,
        reference: method === "CASH" ? undefined : reference.trim(),
        version: liveOrder.version,
        idempotencyKey: tenderKey.next(),
      },
      {
        onSuccess: (updated) => {
          setLiveOrder(updated);
          onOrderChange?.(updated);
          setAmountReceived("");
          setTenderAmount("");
          setReference("");
          if ((updated.remainingMinor ?? 0) <= 0 || updated.status === "CLOSED") {
            onSettled(updated.id);
          }
        },
      },
    );
  }

  function submitRoomCharge(): void {
    if (!selected) return;
    chargeToRoom.mutate(
      { orderId: liveOrder.id, stayId: selected.stayId, idempotencyKey: roomChargeKey.current },
      { onSuccess: () => onSettled(liveOrder.id) },
    );
  }

  const showRoomChargeTab = roomChargeAvailable.data === true && paidMinor === 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="terminal-dialog max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] max-w-none overflow-y-auto p-5 sm:max-w-[560px]"
        data-testid="settle-dialog"
        showCloseButton={false}
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div>
            <DialogTitle className="text-base font-bold text-[var(--foreground)]">Settle {liveOrder.orderNumber}</DialogTitle>
            <DialogDescription className="mt-1 text-xs text-[var(--foreground-muted)]">
              {liveOrder.serviceType.replaceAll("_", " ")}
            </DialogDescription>
          </div>
          <button data-testid="settle-close" onClick={onClose} className="grid size-11 place-items-center rounded-md text-[var(--foreground-muted)] hover:bg-[var(--surface-interactive)]" aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="settlement-due">
          <span>Remaining</span>
          <strong className="money-display" data-testid="amount-due">{formatMinor(dueMinor, currency)}</strong>
        </div>
        {paidMinor > 0 && (
          <p className="mt-1 text-[11px] text-[var(--foreground-muted)]" data-testid="amount-paid">
            Paid {formatMinor(paidMinor, currency)} of {formatMinor(liveOrder.totalMinor, currency)}
          </p>
        )}
        {(liveOrder.discountMinor ?? 0) > 0 && (
          <p className="mt-1 text-[11px] text-[var(--foreground-muted)]" data-testid="amount-discount">
            Discount −{formatMinor(liveOrder.discountMinor, currency)}
            {liveOrder.discountReason ? ` · ${liveOrder.discountReason}` : ""}
          </p>
        )}

        {showRoomChargeTab && (
          <div className="mt-4 flex gap-2">
            <button
              data-testid="settle-tab-tender"
              onClick={() => setTab("tender")}
              className={`pill-filter-btn ${tab === "tender" ? "active" : ""}`}
            >
              Pay now
            </button>
            <button
              data-testid="settle-tab-room"
              onClick={() => setTab("room")}
              className={`pill-filter-btn ${tab === "room" ? "active" : ""}`}
            >
              Charge to room
            </button>
          </div>
        )}

        {tab === "tender" ? (
          <>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  data-testid={`method-${m.id}`}
                  onClick={() => setMethod(m.id)}
                  aria-pressed={method === m.id}
                  className="tender-tile"
                >
                  {m.label}
                </button>
              ))}
            </div>
            {METHODS.find((m) => m.id === method)?.helper && (
              <p className="mt-2 text-[11px] text-[var(--foreground-muted)]">{METHODS.find((m) => m.id === method)!.helper}</p>
            )}

            {method === "CASH" ? (
              <div className="mt-4 space-y-2">
                <label htmlFor="amount-received" className="block text-xs font-semibold text-[var(--foreground-muted)]">Amount received</label>
                <input
                  id="amount-received"
                  data-testid="amount-received"
                  type="number"
                  inputMode="decimal"
                  value={amountReceived}
                  onChange={(event) => setAmountReceived(event.target.value)}
                  className="input w-full"
                />
                {receivedMinor != null && (
                  <p className="settlement-change" data-testid="change-due">
                    <span>Applied / change</span>
                    <strong className="money-display">
                      {formatMinor(applyMinor, currency)}
                      {changeDueMinor != null && changeDueMinor > 0
                        ? ` · change ${formatMinor(changeDueMinor, currency)}`
                        : ""}
                    </strong>
                    <span className="ml-1 text-[11px] text-[var(--foreground-muted)]">(display only)</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <label htmlFor="tender-amount" className="block text-xs font-semibold text-[var(--foreground-muted)]">
                  Tender amount (blank = remaining)
                </label>
                <input
                  id="tender-amount"
                  data-testid="tender-amount"
                  type="number"
                  inputMode="decimal"
                  value={tenderAmount}
                  onChange={(event) => setTenderAmount(event.target.value)}
                  placeholder={formatMinor(dueMinor, currency)}
                  className="input w-full"
                />
                <label htmlFor="tender-reference" className="block text-xs font-semibold text-[var(--foreground-muted)]">Reference</label>
                <input
                  id="tender-reference"
                  data-testid="tender-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Transaction id, phone number, or note"
                  className="input w-full"
                />
              </div>
            )}

            {tenderError && (
              <div className="badge badge-danger mt-4" data-testid="settle-error">
                {tenderError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="btn-tertiary btn-sm">
                Cancel
              </button>
              <button data-testid="confirm-settle" onClick={submitTender} disabled={!canSubmitTender} className="btn-primary btn-sm">
                <Icon name="check" size={14} />
                {recordTender.isPending
                  ? "Recording…"
                  : applyMinor > 0 && applyMinor < dueMinor
                    ? "Record partial"
                    : "Confirm"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 space-y-2">
              <label htmlFor="room-query" className="block text-xs font-semibold text-[var(--foreground-muted)]">Room or guest name</label>
              <input
                id="room-query"
                data-testid="room-query"
                value={roomQuery}
                onChange={(event) => {
                  setRoomQuery(event.target.value);
                  setSelected(null);
                }}
                placeholder="204 or Amina"
                className="input w-full"
              />
              <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--border-subtle)]">
                {(candidates.data ?? []).length === 0 ? (
                  <div className="px-3 py-2 text-[12px] text-[var(--foreground-muted)]" data-testid="room-candidates-empty">
                    {debouncedQuery ? (candidates.isFetching ? "Searching…" : "No in-house stay matches") : "Type a room number to search in-house stays"}
                  </div>
                ) : (
                  (candidates.data ?? []).map((candidate) => {
                    const eligible = candidate.postingEligible !== false;
                    return (
                      <button
                        key={candidate.stayId}
                        type="button"
                        data-testid={`room-candidate-${candidate.stayId}`}
                        disabled={!eligible}
                        onClick={() => setSelected(candidate)}
                        className={`flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs ${
                          selected?.stayId === candidate.stayId
                            ? "bg-[var(--gold-accent)]/10 text-[var(--foreground)]"
                            : eligible
                              ? "text-[var(--foreground)] hover:bg-[var(--border-subtle)]"
                              : "cursor-not-allowed text-[var(--foreground-muted)]"
                        }`}
                      >
                        <span>
                          {candidate.roomNumber} · {candidate.guestDisplayName}
                        </span>
                        {!eligible && <span>Not ready to post</span>}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {roomChargeError && (
              <div className="badge badge-danger mt-4" data-testid="room-charge-error">
                {roomChargeError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="btn-tertiary btn-sm">
                Cancel
              </button>
              <button data-testid="confirm-room-charge" onClick={submitRoomCharge} disabled={!canSubmitRoomCharge} className="btn-primary btn-sm">
                <Icon name="check" size={14} />
                {chargeToRoom.isPending ? "Posting…" : "Charge to room"}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
