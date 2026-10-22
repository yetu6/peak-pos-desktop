import { BACK_WORDS } from "../lib/words";
import { useState } from "react";
import { Button, ReasonPicker, RefusalNotice, Sheet } from "../components/system";
import { useTillReasons } from "../fnb/useTillReasons";
import { useIdempotencyKey, useRecordDrawerOpened } from "../hooks/usePosData";
import type { POSCashMovement } from "../lib/posContracts";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { DRAWER_REASONS } from "./cashSettings";
import { drawerOpenProblem } from "./cashWords";

/**
 * Open the drawer without a sale (owner, 2026-10-21): change for a guest's
 * note, a check of the float. Anyone who takes money may, with no supervisor,
 * but Yetu records who, when and why first; the drawer opens once it has.
 */
export function OpenDrawerSheet({
  shiftId,
  onClose,
  onRecorded,
}: {
  shiftId: string;
  onClose: () => void;
  /** Yetu has recorded the opening: the page opens the drawer and says so. */
  onRecorded: (opening: POSCashMovement) => void;
}) {
  const record = useRecordDrawerOpened(shiftId);
  const idempotencyKey = useIdempotencyKey();
  // The till doesn't lock itself while the opening is with Yetu.
  useHoldIdleLock(record.isPending);
  return (
    <OpenDrawerSheetView
      reasons={useTillReasons("drawer")}
      pending={record.isPending}
      error={record.error}
      onClose={onClose}
      onOpen={(reason) => record.mutate({ reason, idempotencyKey: idempotencyKey.next() }, { onSuccess: onRecorded })}
    />
  );
}

export interface OpenDrawerSheetViewProps {
  reasons?: readonly string[];
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onOpen: (reason: string) => void;
}

export function OpenDrawerSheetView({ reasons = DRAWER_REASONS, pending, error, onClose, onOpen }: OpenDrawerSheetViewProps) {
  const [reason, setReason] = useState("");
  const problem = drawerOpenProblem(error);
  const canOpen = reason.trim().length > 0 && !pending;
  return (
    <Sheet
      open
      // While Yetu is recording it, Escape, Close and a tap outside do nothing.
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title="Open the drawer"
      description="No sale. Yetu keeps who opened it, when and why, on the shift's cash record."
      testId="open-drawer-sheet"
      footer={
        <div className="y-cash__footer">
          <Button variant="quiet" disabled={pending} onClick={onClose}>
            {BACK_WORDS}
          </Button>
          <Button variant="primary" size={56} data-testid="confirm-open-drawer" disabled={!canOpen} onClick={() => canOpen && onOpen(reason.trim())}>
            {pending ? "Recording…" : "Open the drawer"}
          </Button>
        </div>
      }
    >
      <div className="y-form">
        <ReasonPicker
          label="Why it opens"
          reasons={reasons}
          initialReason={reason}
          onChange={setReason}
          otherHint="Written in the shift's cash record."
          testIdPrefix="drawer-reason"
        />
        {problem ? (
          <div data-testid="open-drawer-error">
            <RefusalNotice refusal={problem} />
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
