import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import {
  usePaymentProviderAccounts,
  usePropertyId,
  useRoomChargeCandidates,
  useSettleOrder,
} from "../hooks/usePosData";
import type { PosOrderResponse, PosRoomChargeCandidateResponse } from "../lib/posApi";
import { processPendingPrintJobs } from "../lib/printJobs";

const METHODS = [
  { id: "cash", label: "Cash" },
  { id: "mobile_money", label: "Mobile money" },
  { id: "room_charge", label: "Room charge" },
] as const;

const SEARCH_DEBOUNCE_MS = 250;

function formatAmount(value: number | undefined | null): string {
  return value != null ? String(value) : "—";
}

export function SettleDialog({
  order,
  onClose,
}: {
  order: PosOrderResponse;
  onClose: () => void;
}) {
  const propertyId = usePropertyId();
  const settle = useSettleOrder(propertyId);
  const [method, setMethod] = useState<(typeof METHODS)[number]["id"]>("cash");
  const [providerAccountId, setProviderAccountId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [roomQuery, setRoomQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState<PosRoomChargeCandidateResponse | null>(null);
  const { data: providerAccounts = [] } = usePaymentProviderAccounts(propertyId);
  const candidates = useRoomChargeCandidates(propertyId, debouncedQuery);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(roomQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [roomQuery]);

  const canSubmit = useMemo(() => {
    if (settle.isPending) return false;
    if (method === "cash") return true;
    if (method === "mobile_money") {
      return Boolean(providerAccountId) && Boolean(phoneNumber.trim());
    }
    return selected != null && Boolean(selected.stayId) && selected.postingEligible !== false;
  }, [method, providerAccountId, phoneNumber, selected, settle.isPending]);

  function chooseMethod(next: (typeof METHODS)[number]["id"]): void {
    setMethod(next);
    if (next !== "room_charge") setSelected(null);
  }

  function submit(): void {
    settle.mutate(
      {
        orderId: String(order.id),
        method,
        providerAccountId: providerAccountId || undefined,
        phoneNumber: phoneNumber || undefined,
        stayId: selected?.stayId,
        roomNumber: selected?.roomNumber,
      },
      {
        onSuccess: async (data) => {
          try {
            if (method !== "mobile_money" && data?.id) {
              await processPendingPrintJobs(propertyId, String(data.id));
            }
          } finally {
            onClose();
          }
        },
      },
    );
  }

  return (
    <div
      className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="settle-dialog"
    >
      <div className="glass-dialog w-full max-w-md p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">
              Settle {order.orderNumber}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
              {order.orderType} · {formatAmount(order.totalAmount)}
            </div>
          </div>
          <button
            data-testid="settle-close"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)]"
            aria-label="Close"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {METHODS.map((m) => (
            <button
              key={m.id}
              data-testid={`method-${m.id}`}
              onClick={() => chooseMethod(m.id)}
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

        {method === "mobile_money" && (
          <div className="mt-4 space-y-2">
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Payment provider
            </label>
            <select
              data-testid="provider-account"
              value={providerAccountId}
              onChange={(e) => setProviderAccountId(e.target.value)}
              className="input w-full"
            >
              <option value="">Select provider…</option>
              {providerAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.providerName ?? account.id}
                </option>
              ))}
            </select>
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Guest phone (E.164)
            </label>
            <input
              data-testid="phone-number"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+255 7XX XXX XXX"
              className="input w-full"
            />
          </div>
        )}

        {method === "room_charge" && (
          <div className="mt-4 space-y-2">
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Room or guest name
            </label>
            <input
              data-testid="room-query"
              value={roomQuery}
              onChange={(e) => {
                setRoomQuery(e.target.value);
                setSelected(null);
              }}
              placeholder="204 or Amina"
              className="input w-full"
            />
            <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)]">
              {(candidates.data ?? []).length === 0 ? (
                <div
                  className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]"
                  data-testid="room-candidates-empty"
                >
                  {debouncedQuery
                    ? candidates.isFetching
                      ? "Searching…"
                      : "No in-house stay matches"
                    : "Type a room number to search in-house stays"}
                </div>
              ) : (
                (candidates.data ?? []).map((candidate) => {
                  const id = String(candidate.stayId);
                  const eligible = candidate.postingEligible !== false;
                  return (
                    <button
                      key={id}
                      type="button"
                      data-testid={`room-candidate-${id}`}
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
        )}

        {settle.isError && (
          <div className="badge badge-danger mt-4" data-testid="settle-error">
            {settle.error instanceof Error ? settle.error.message : "Settlement failed"}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-tertiary btn-sm">
            Cancel
          </button>
          <button
            data-testid="confirm-settle"
            onClick={submit}
            disabled={!canSubmit}
            className="btn-primary btn-sm"
          >
            <Icon name="check" size={14} />
            {settle.isPending ? "Settling…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
