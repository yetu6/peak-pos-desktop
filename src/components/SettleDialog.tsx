import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import {
  usePaymentProviderAccounts,
  usePropertyId,
  useSettleOrder,
} from "../hooks/usePosData";
import type { PosOrderResponse } from "../lib/posApi";

const METHODS = [
  { id: "cash", label: "Cash" },
  { id: "mobile_money", label: "Mobile money" },
] as const;

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
  const { data: providerAccounts = [] } = usePaymentProviderAccounts(propertyId);

  const canSubmit = useMemo(() => {
    if (settle.isPending) return false;
    if (method === "cash") return true;
    return Boolean(providerAccountId) && Boolean(phoneNumber.trim());
  }, [method, providerAccountId, phoneNumber, settle.isPending]);

  function submit(): void {
    settle.mutate(
      {
        orderId: String(order.id),
        method,
        providerAccountId: providerAccountId || undefined,
        phoneNumber: phoneNumber || undefined,
      },
      {
        onSuccess: () => onClose(),
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

        <div className="mt-4 grid grid-cols-2 gap-2">
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
