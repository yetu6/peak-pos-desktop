import { useState } from "react";
import { Icon } from "./Icon";
import { moneyFormatter, toMinor } from "../lib/posMoney";
import { useHasPermission, useIdempotencyKey, useMutationMessage, usePosShift } from "../hooks/usePosData";

/**
 * Opening float and cash-counted are money entry: parsed once via `toMinor`
 * into an integer minor-unit amount, never floating point, and never
 * combined client-side into an authoritative total — Peak computes
 * `expectedCashMinor` and `varianceMinor` itself on close. R6A-C: open/close
 * are additionally composed from this staff member's own authoritative
 * pos.shift.open/close grant (e.g. a WAITER cannot open a shift) — the
 * backend still refuses the mutation outright regardless of this check.
 */
export function TillControls({ currency }: { currency?: string }) {
  const { shift, open, close } = usePosShift();
  const money = moneyFormatter(currency);
  const [openingFloat, setOpeningFloat] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const openKey = useIdempotencyKey();
  const closeKey = useIdempotencyKey();
  const openError = useMutationMessage(open.error);
  const closeError = useMutationMessage(close.error);
  const canOpenShift = useHasPermission("pos.shift.open");
  const canCloseShift = useHasPermission("pos.shift.close");

  const openingMinor = toMinor(openingFloat);
  const countedMinor = toMinor(countedCash);

  function submitOpen(): void {
    if (openingMinor == null) return;
    const key = openKey.next();
    open.mutate({ openingCashMinor: openingMinor, idempotencyKey: key });
  }

  function submitClose(): void {
    if (countedMinor == null) return;
    const key = closeKey.next();
    close.mutate({ countedCashMinor: countedMinor, idempotencyKey: key });
  }

  const pendingVariance = close.data?.status === "PENDING_VARIANCE_APPROVAL";

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="till-controls">
      {shift ? (
        canCloseShift ? (
          <>
            <span className="badge badge-success badge-dot" data-testid="shift-open">
              Shift open · expected {money(shift.expectedCashMinor)}
            </span>
            <input
              data-testid="counted-cash"
              type="number"
              value={countedCash}
              onChange={(event) => setCountedCash(event.target.value)}
              placeholder="Cash counted"
              className="input w-32"
            />
            <button
              data-testid="close-shift"
              onClick={submitClose}
              disabled={close.isPending || countedMinor == null}
              className="btn-tertiary btn-sm"
            >
              Close shift
            </button>
          </>
        ) : (
          <span className="badge badge-success badge-dot" data-testid="shift-open">
            Shift open · expected {money(shift.expectedCashMinor)}
          </span>
        )
      ) : canOpenShift ? (
        <>
          <input
            data-testid="opening-float"
            type="number"
            value={openingFloat}
            onChange={(event) => setOpeningFloat(event.target.value)}
            placeholder="Opening float"
            className="input w-32"
          />
          <button
            data-testid="open-shift"
            onClick={submitOpen}
            disabled={open.isPending || openingMinor == null}
            className="btn-primary btn-sm"
          >
            <Icon name="check" size={14} />
            {open.isPending ? "Opening…" : "Open shift"}
          </button>
        </>
      ) : (
        <span className="badge badge-muted" data-testid="shift-open-unavailable">
          No shift open — ask a cashier to open one.
        </span>
      )}
      {openError && (
        <div className="badge badge-danger" data-testid="open-error">
          {openError}
        </div>
      )}
      {closeError && (
        <div className="badge badge-danger" data-testid="close-error">
          {closeError}
        </div>
      )}
      {close.data && !shift && (
        <span className={pendingVariance ? "badge badge-warning" : "badge badge-muted"} data-testid="shift-close-result">
          {pendingVariance
            ? `Variance ${money(close.data.varianceMinor)} needs a supervisor`
            : "Shift closed"}
        </span>
      )}
    </div>
  );
}
