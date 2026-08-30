import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
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
    <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="settle-dialog">
      <div className="glass-dialog w-full max-w-md p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">Settle {order.orderNumber}</div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
              {order.serviceType.replaceAll("_", " ")} · {formatMinor(order.totalMinor, currency)}
            </div>
          </div>
          <button data-testid="settle-close" onClick={onClose} className="rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)]" aria-label="Close">
            <Icon name="x" size={16} />
          </button>
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
            <div className="mt-4 grid grid-cols-3 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  data-testid={`method-${m.id}`}
                  onClick={() => setMethod(m.id)}
                  className={`rounded-lg border px-2 py-2 text-[12px] font-medium transition-colors ${
                    method === m.id
                      ? "border-[var(--color-gold)] bg-[var(--color-gold)]/10 text-[var(--color-text-primary)]"
                      : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border)]"
                  }`}
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
                <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">Amount received</label>
                <input
                  data-testid="amount-received"
                  type="number"
                  value={amountReceived}
                  onChange={(event) => setAmountReceived(event.target.value)}
                  className="input w-full"
                />
                {receivedMinor != null && (
                  <p className="text-[12px] text-[var(--color-text-secondary)]" data-testid="change-due">
                    Change due: {formatMinor(changeDueMinor ?? 0, currency)}
                    <span className="ml-1 text-[11px] text-[var(--color-text-muted)]">(display only)</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">Reference</label>
                <input
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
              <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">Room or guest name</label>
              <input
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
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] ${
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
      </div>
    </div>
  );
}
