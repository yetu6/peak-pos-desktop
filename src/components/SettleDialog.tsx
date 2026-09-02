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
 * Peak's actual tender contract: one exact `paymentMethod` from
 * CASH/MOBILE_MONEY/BANK_TRANSFER/EXTERNAL_CARD/OTHER, an `amountMinor`,
 * and an optional free-text `reference` — there is no payment-provider
 * account concept in the certified backend. Non-cash methods are an
 * external settlement Peak *records*, never a PSP Peak processes; the copy
 * says so explicitly instead of implying integrated processing.
 */
const METHODS: Array<{ id: PaymentMethod; label: string; helper?: string }> = [
  { id: "CASH", label: "Cash" },
  { id: "MOBILE_MONEY", label: "Mobile money", helper: "Records an external mobile money payment" },
  { id: "BANK_TRANSFER", label: "Bank transfer", helper: "Records an external bank transfer" },
  { id: "EXTERNAL_CARD", label: "Card", helper: "Records an external card payment" },
  { id: "OTHER", label: "Other" },
];

const SEARCH_DEBOUNCE_MS = 250;

export function SettleDialog({
  order,
  currency = "TZS",
  onClose,
  onSettled,
}: {
  order: POSOrder;
  currency?: string;
  onClose: () => void;
  onSettled: (orderId: string) => void;
}) {
  const [tab, setTab] = useState<"tender" | "room">("tender");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
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

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(roomQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [roomQuery]);

  const receivedMinor = toMinor(amountReceived);
  const changeDueMinor =
    method === "CASH" && receivedMinor != null ? Math.max(0, receivedMinor - order.totalMinor) : null;

  const canSubmitTender = useMemo(() => {
    if (recordTender.isPending) return false;
    if (method === "CASH") return receivedMinor != null && receivedMinor >= order.totalMinor;
    return reference.trim().length > 0;
  }, [method, receivedMinor, order.totalMinor, reference, recordTender.isPending]);

  const canSubmitRoomCharge = selected != null && selected.postingEligible !== false && !chargeToRoom.isPending;

  function submitTender(): void {
    recordTender.mutate(
      {
        orderId: order.id,
        paymentMethod: method,
        amountMinor: order.totalMinor,
        reference: method === "CASH" ? undefined : reference.trim(),
        version: order.version,
        idempotencyKey: tenderKey.current,
      },
      { onSuccess: () => onSettled(order.id) },
    );
  }

  function submitRoomCharge(): void {
    if (!selected) return;
    chargeToRoom.mutate(
      { orderId: order.id, stayId: selected.stayId, idempotencyKey: roomChargeKey.current },
      { onSuccess: () => onSettled(order.id) },
    );
  }

  const showRoomChargeTab = roomChargeAvailable.data === true;

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
            <DialogTitle className="text-base font-bold text-[var(--foreground)]">Settle {order.orderNumber}</DialogTitle>
            <DialogDescription className="mt-1 text-xs text-[var(--foreground-muted)]">
              {order.serviceType.replaceAll("_", " ")}
            </DialogDescription>
          </div>
          <button data-testid="settle-close" onClick={onClose} className="grid size-11 place-items-center rounded-md text-[var(--foreground-muted)] hover:bg-[var(--surface-interactive)]" aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="settlement-due">
          <span>Amount due</span>
          <strong className="money-display" data-testid="amount-due">{formatMinor(order.totalMinor, currency)}</strong>
        </div>

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
              <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">{METHODS.find((m) => m.id === method)!.helper}</p>
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
                    <span>Change due</span>
                    <strong className="money-display">{formatMinor(changeDueMinor ?? 0, currency)}</strong>
                    <span className="ml-1 text-[11px] text-[var(--color-text-muted)]">(display only)</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-2">
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
                {recordTender.isPending ? "Settling…" : "Confirm"}
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
              <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)]">
                {(candidates.data ?? []).length === 0 ? (
                  <div className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]" data-testid="room-candidates-empty">
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
                            ? "bg-[var(--color-gold)]/10 text-[var(--color-text-primary)]"
                            : eligible
                              ? "text-[var(--color-text-primary)] hover:bg-[var(--color-border-subtle)]"
                              : "cursor-not-allowed text-[var(--color-text-muted)]"
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
