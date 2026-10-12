import { ArrowDownToLine, ArrowUpFromLine, Banknote } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useDeviceSessionOptional } from "../auth/DeviceSessionProvider";
import { CloseDayCard } from "../cash/CloseDayCard";
import { CloseShiftSheet } from "../cash/CloseShiftSheet";
import { CashMovementDialog } from "../components/CashMovementDialog";
import { Button, EmptyState, ListRow, Money, PermissionNotice } from "../components/system";
import {
  useCashMovements,
  useCatalogCurrency,
  useHasCapability,
  useHasPermission,
  usePosShift,
} from "../hooks/usePosData";
import type { RosterEntry } from "../lib/deviceAuth";
import type { CashMovementType, POSCashMovement, POSShift } from "../lib/posContracts";
import { cashMovementWords, clockTime, shiftChipWords } from "../lib/words";

/**
 * Cash: the drawer for this shift. Every figure is Yetu's own (the float it
 * was opened with and what it expects now); the till adds nothing up. Cash in
 * and out are listed with their reasons and who recorded them. Closing the
 * shift and closing the day start here. The backend checks every action
 * again; the permission notices only say who can do what.
 */
export function Manager() {
  const { shift } = usePosShift();
  const movements = useCashMovements(shift?.id);
  const currency = useCatalogCurrency();
  const device = useDeviceSessionOptional();
  const canRecordCash = useHasPermission("pos.cash_movement.record");
  const canCloseShift = useHasPermission("pos.shift.close");
  const isManager = useHasPermission("pos.report.manager");
  const hotel = useHasCapability("LODGING");
  const [movement, setMovement] = useState<CashMovementType | null>(null);
  const [closing, setClosing] = useState(false);
  const roster = device?.roster ?? [];
  const requesterId = device?.session?.staffId ?? "";

  return (
    <CashView
      shift={shift}
      currency={currency}
      movements={movements.data ?? []}
      roster={roster}
      canRecordCash={canRecordCash}
      canCloseShift={canCloseShift}
      closeDay={isManager && !hotel ? <CloseDayCard thisTillShiftOpen={Boolean(shift)} /> : null}
      onCashIn={() => setMovement("CASH_IN")}
      onCashOut={() => setMovement("CASH_OUT")}
      onCloseShift={() => setClosing(true)}
    >
      {movement && shift ? (
        <CashMovementDialog shiftId={shift.id} currency={currency} initialType={movement} onClose={() => setMovement(null)} />
      ) : null}
      {closing && shift ? (
        <CloseShiftSheet
          open
          onOpenChange={setClosing}
          shift={shift}
          currency={currency}
          requesterId={requesterId}
          roster={roster}
        />
      ) : null}
    </CashView>
  );
}

export interface CashViewProps {
  shift: POSShift | null | undefined;
  currency: string | undefined;
  movements: readonly POSCashMovement[];
  roster: readonly RosterEntry[];
  canRecordCash: boolean;
  canCloseShift: boolean;
  /** The Close the day card, for managers on a restaurant-only property. */
  closeDay: ReactNode;
  onCashIn: () => void;
  onCashOut: () => void;
  onCloseShift: () => void;
  /** Open sheets. */
  children?: ReactNode;
}

export function CashView({
  shift,
  currency,
  movements,
  roster,
  canRecordCash,
  canCloseShift,
  closeDay,
  onCashIn,
  onCashOut,
  onCloseShift,
  children,
}: CashViewProps) {
  const nameOf = (staffId: string | undefined) => roster.find((entry) => entry.staffNumber === staffId)?.fullName;

  return (
    <div className="y-cash">
      <header className="y-cash__header">
        <h1 className="y-cash__title">Cash</h1>
        {shift ? <p className="y-cash__muted">{shiftChipWords(shift).full}</p> : null}
      </header>

      <div className="y-cash__grid">
        <div className="y-cash__column">
          <section className="y-cash__card" aria-labelledby="drawer-title">
            <h2 id="drawer-title" className="y-cash__card-title">
              In the drawer
            </h2>
            {shift ? (
              <dl className="y-cash__summary" data-testid="cash-summary">
                <div>
                  <dt>Float at the start</dt>
                  <dd>
                    <Money minor={shift.openingCashMinor} currency={currency} size="title" />
                  </dd>
                  <dd className="y-cash__muted">Counted into the drawer when the shift opened.</dd>
                </div>
                <div>
                  <dt>Expected in the drawer now</dt>
                  <dd>
                    <Money minor={shift.expectedCashMinor} currency={currency} size="title" />
                  </dd>
                  <dd className="y-cash__muted">Float, plus cash sales and cash in, less cash out, worked out by Yetu.</dd>
                </div>
              </dl>
            ) : (
              <p className="y-cash__muted">No shift is open on this till.</p>
            )}

            {canRecordCash ? (
              <div className="y-cash__actions">
                <Button
                  variant="secondary"
                  size={56}
                  icon={<ArrowDownToLine />}
                  data-testid="open-cash-movement"
                  disabled={!shift}
                  onClick={onCashIn}
                >
                  Cash in
                </Button>
                <Button
                  variant="secondary"
                  size={56}
                  icon={<ArrowUpFromLine />}
                  data-testid="open-cash-out"
                  disabled={!shift}
                  onClick={onCashOut}
                >
                  Cash out
                </Button>
              </div>
            ) : (
              <div data-testid="cash-movement-unavailable">
                <PermissionNotice who="a cashier or manager" action="put cash in or take it out" next="Ask one to help." />
              </div>
            )}
          </section>

          <section className="y-cash__card" aria-labelledby="movements-title">
            <h2 id="movements-title" className="y-cash__card-title">
              Cash in and out this shift
            </h2>
            {shift ? (
              <div data-testid="cash-movement-list">
                {movements.length === 0 ? (
                  <EmptyState
                    icon={<Banknote />}
                    title="No cash in or out yet"
                    description="Cash put in or taken out during this shift is listed here."
                  />
                ) : (
                  movements.map((entry) => {
                    const who = nameOf(entry.recordedBy);
                    const when = entry.createdAt ? clockTime(entry.createdAt) : "";
                    return (
                      <ListRow
                        key={entry.id}
                        title={cashMovementWords(entry.movementType)}
                        meta={[entry.reason, who, when].filter(Boolean).join(" · ")}
                        trailing={<Money minor={entry.amountMinor} currency={currency} size="lead" />}
                      />
                    );
                  })
                )}
              </div>
            ) : null}
          </section>
        </div>

        <div className="y-cash__column">
          <section className="y-cash__card" aria-labelledby="close-shift-title">
            <h2 id="close-shift-title" className="y-cash__card-title">
              Close this shift
            </h2>
            <p className="y-cash__muted">
              Count the drawer first. Yetu then shows what it expects; if they differ, a manager approves.
            </p>
            {canCloseShift ? (
              <Button
                variant="primary"
                size={64}
                block
                data-testid="open-close-shift"
                disabled={!shift}
                onClick={onCloseShift}
              >
                Close shift
              </Button>
            ) : (
              <div data-testid="close-shift-unavailable">
                <PermissionNotice who="a cashier or manager" action="close the shift" next="Ask one to close it." />
              </div>
            )}
          </section>

          {closeDay}
        </div>
      </div>

      {children}
    </div>
  );
}
