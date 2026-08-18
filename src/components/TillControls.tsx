import { useState } from "react";
import { Icon } from "./Icon";
import type { PosSessionResponse } from "../lib/posApi";

function money(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  return String(value);
}

interface TillMutation<TData> {
  mutate: (value: number) => void;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data?: TData;
}

export function TillControls({
  session,
  open,
  close,
}: {
  session: PosSessionResponse | null;
  open: TillMutation<PosSessionResponse>;
  close: TillMutation<PosSessionResponse | undefined>;
}) {
  const [openingFloat, setOpeningFloat] = useState("");
  const [actualCash, setActualCash] = useState("");

  const closed = close.data;
  const pendingVariance = closed?.status === "pending_variance_approval";

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="till-controls">
      {session ? (
        <>
          <span className="badge badge-success badge-dot" data-testid="session-open">
            Till open · expected {money(session.expectedCash)}
          </span>
          <input
            data-testid="actual-cash"
            type="number"
            value={actualCash}
            onChange={(event) => setActualCash(event.target.value)}
            placeholder="Cash in drawer"
            className="input w-32"
          />
          <button
            data-testid="close-session"
            onClick={() => close.mutate(Number(actualCash))}
            disabled={
              close.isPending || !Number.isFinite(Number(actualCash)) || actualCash.trim() === ""
            }
            className="btn-tertiary btn-sm"
          >
            Close till
          </button>
        </>
      ) : (
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
            data-testid="open-session"
            onClick={() => open.mutate(Number(openingFloat))}
            disabled={
              open.isPending ||
              !Number.isFinite(Number(openingFloat)) ||
              openingFloat.trim() === ""
            }
            className="btn-primary btn-sm"
          >
            <Icon name="check" size={14} />
            {open.isPending ? "Opening…" : "Open till"}
          </button>
        </>
      )}
      {open.isError && (
        <div className="badge badge-danger" data-testid="open-error">
          {open.error instanceof Error ? open.error.message : "Could not open the till"}
        </div>
      )}
      {close.isError && (
        <div className="badge badge-danger" data-testid="close-error">
          {close.error instanceof Error ? close.error.message : "Could not close the till"}
        </div>
      )}
      {closed && !session && (
        <span
          className={pendingVariance ? "badge badge-warning" : "badge badge-muted"}
          data-testid="till-close-result"
        >
          {pendingVariance
            ? `Variance ${money(closed.variance)} needs a supervisor`
            : "Till closed"}
        </span>
      )}
    </div>
  );
}
