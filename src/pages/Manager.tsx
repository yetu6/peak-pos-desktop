import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, Banknote, Inbox } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useDeviceSessionOptional } from "../auth/DeviceSessionProvider";
import { CloseDayCard } from "../cash/CloseDayCard";
import { CloseShiftSheet } from "../cash/CloseShiftSheet";
import { OpenDrawerSheet } from "../cash/OpenDrawerSheet";
import { useExpectedCashVisible } from "../cash/useExpectedCashVisible";
import { CashMovementDialog } from "../components/CashMovementDialog";
import { Banner, Button, EmptyState, ListRow, Money, PermissionNotice } from "../components/system";
import {
  useCashMovements,
  useCatalogCurrency,
  useHasCapability,
  useHasPermission,
  usePosShift,
} from "../hooks/usePosData";
import type { RosterEntry } from "../lib/deviceAuth";
import type { CashMoneyType, POSCashMovement, POSShift } from "../lib/posContracts";
import { cashMovementWords, clockTime, shiftChipWords } from "../lib/words";
import { drawerFitted, openDrawer } from "../print/cashDrawer";
import { drawerNotOpenedWords } from "../print/printProblems";
import { loadPrinterSettings } from "../print/printerStore";

/**
 * Cash: the drawer for this shift. Every figure is Yetu's own (the float it
 * was opened with and, for those allowed to see it, what it expects now);
 * the till adds nothing up. Cash in
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
  const showExpected = useExpectedCashVisible();
  const hotel = useHasCapability("LODGING");
  const [movement, setMovement] = useState<CashMoneyType | null>(null);
  const [closing, setClosing] = useState(false);
  const [openingDrawer, setOpeningDrawer] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "danger"; words: string } | null>(null);
  const canOpenDrawer = useHasPermission("pos.cash_drawer.open");
  // A till without a drawer (a laptop) never offers to open one.
  const printers = useQuery({ queryKey: ["printers", "settings"], queryFn: loadPrinterSettings });
  const fitted = printers.data ? drawerFitted(printers.data) : false;

  /** Yetu has recorded the cash or the opening: the drawer opens, and a drawer that didn't is said. */
  function openTheDrawer(opened: string) {
    void openDrawer(printers.data).then((result) =>
      setNotice(
        result.ok
          ? { tone: "info", words: opened }
          : { tone: "danger", words: drawerNotOpenedWords(result.error ?? "") },
      ),
    );
  }
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
      showExpected={showExpected}
      closeDay={isManager && !hotel ? <CloseDayCard thisTillShiftOpen={Boolean(shift)} /> : null}
      notice={notice}
      onOpenDrawer={fitted && canOpenDrawer ? () => setOpeningDrawer(true) : undefined}
      onCashIn={() => setMovement("CASH_IN")}
      onCashOut={() => setMovement("CASH_OUT")}
      onCloseShift={() => setClosing(true)}
    >
      {movement && shift ? (
        <CashMovementDialog
          shiftId={shift.id}
          currency={currency}
          initialType={movement}
          onClose={() => setMovement(null)}
          onRecorded={() => openTheDrawer(movement === "CASH_OUT" ? "Cash out recorded. The drawer opened." : "Cash in recorded. The drawer opened.")}
        />
      ) : null}
      {openingDrawer && shift ? (
        <OpenDrawerSheet
          shiftId={shift.id}
          onClose={() => setOpeningDrawer(false)}
          onRecorded={(opening) => {
            setOpeningDrawer(false);
            openTheDrawer(`The drawer opened: ${opening.reason}.`);
          }}
        />
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
  /** Yetu's expected figure, for those allowed to see it before counting (EXPECTED_CASH_VISIBLE_TO). */
  showExpected: boolean;
  /** The Close the day card, for managers on a restaurant-only property. */
  closeDay: ReactNode;
  /** Manager → Printers (S8a): shown to a manager. */
  printers?: ReactNode;
  /** What the drawer just did, said once. */
  notice?: { tone: "info" | "danger"; words: string } | null;
  /** Open the drawer without a sale: only on a till with a drawer, for those allowed (2026-10-21). */
  onOpenDrawer?: () => void;
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
  showExpected,
  closeDay,
  printers = null,
  notice = null,
  onOpenDrawer,
  onCashIn,
  onCashOut,
  onCloseShift,
  children,
}: CashViewProps) {
  const nameOf = (staffId: string | undefined) => roster.find((entry) => entry.staffNumber === staffId)?.fullName;
  const openDrawerButton = onOpenDrawer ? (
    <Button variant="secondary" size={56} icon={<Inbox />} data-testid="open-drawer" disabled={!shift} onClick={onOpenDrawer}>
      Open drawer
    </Button>
  ) : null;

  return (
    <div className="y-cash">
      <header className="y-cash__header">
        <h1 className="y-cash__title">Cash</h1>
        {shift ? <p className="y-cash__muted">{shiftChipWords(shift).full}</p> : null}
      </header>
      {notice ? (
        <Banner inline tone={notice.tone} data-testid="cash-notice">
          {notice.words}
        </Banner>
      ) : null}

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
                {showExpected ? (
                  <div>
                    <dt>Expected in the drawer now</dt>
                    <dd>
                      <Money minor={shift.expectedCashMinor} currency={currency} size="title" />
                    </dd>
                    <dd className="y-cash__muted">Float, plus cash sales and cash in, less cash out, worked out by Yetu.</dd>
                  </div>
                ) : null}
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
                {openDrawerButton}
              </div>
            ) : (
              <>
                <div data-testid="cash-movement-unavailable">
                  <PermissionNotice who="a cashier or manager" action="put cash in or take it out" next="Ask one to help." />
                </div>
                {openDrawerButton ? <div className="y-cash__actions">{openDrawerButton}</div> : null}
              </>
            )}
          </section>

          <section className="y-cash__card" aria-labelledby="movements-title">
            <h2 id="movements-title" className="y-cash__card-title">
              The drawer this shift
            </h2>
            {shift ? (
              <div data-testid="cash-movement-list">
                {movements.length === 0 ? (
                  <EmptyState
                    icon={<Banknote />}
                    title="No cash in or out yet"
                    description="Cash put in or taken out during this shift, and the drawer opened without a sale, are listed here."
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
                        trailing={
                          entry.movementType === "DRAWER_OPENED" ? undefined : (
                            <Money minor={entry.amountMinor} currency={currency} size="lead" />
                          )
                        }
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
              Count the drawer. Yetu then compares your count with its own figure; if they differ, a manager approves.
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
          {printers}
        </div>
      </div>

      {children}
    </div>
  );
}
