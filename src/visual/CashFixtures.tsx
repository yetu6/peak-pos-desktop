import { PrintersCard } from "../print/PrintersCard";
import { AccessFrame } from "../access/AccessLayout";
import { CloseDayCardView } from "../cash/CloseDayCard";
import { CloseShiftSheetView } from "../cash/CloseShiftSheet";
import { CashMovementSheetView } from "../components/CashMovementDialog";
import type { POSCashMovement, POSShift } from "../lib/posContracts";
import { CashView } from "../pages/Manager";
import { OpenShiftView } from "../pages/OpenShiftScreen";
import { FixtureShell } from "./ShellFixtures";

/**
 * Development-only shift and cash compositions for the pixel harness: the real
 * S3 views with data in the backend's shapes (posContracts.ts). Nothing here
 * talks to a server.
 */

const CURRENCY = "TZS";
const nothing = () => undefined;

const ROSTER = [
  { fullName: "Amina Hassan", staffNumber: "5d3c0000-0f1e-4a2b-8c9d-0e1f2a3b4c5d" },
  { fullName: "Grace Mushi", staffNumber: "5d3c0001-0f1e-4a2b-8c9d-0e1f2a3b4c5d" },
  { fullName: "Juma Ally", staffNumber: "5d3c0002-0f1e-4a2b-8c9d-0e1f2a3b4c5d" },
];
const AMINA = ROSTER[0].staffNumber;

const SHIFT: POSShift = {
  id: "8a1f2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b",
  status: "OPEN",
  openingCashMinor: 5_000_000,
  expectedCashMinor: 7_400_000,
  businessDate: "2026-10-12",
  openedAt: new Date(2026, 9, 12, 7, 2).toISOString(),
};

const MOVEMENTS: POSCashMovement[] = [
  {
    id: "c1",
    shiftId: SHIFT.id,
    movementType: "CASH_OUT",
    amountMinor: 2_000_000,
    reason: "Gas delivery",
    recordedBy: ROSTER[1].staffNumber,
    createdAt: new Date(2026, 9, 12, 11, 5).toISOString(),
  },
  {
    id: "c2",
    shiftId: SHIFT.id,
    movementType: "CASH_IN",
    amountMinor: 1_000_000,
    reason: "Float top-up from the safe",
    recordedBy: AMINA,
    createdAt: new Date(2026, 9, 12, 9, 30).toISOString(),
  },
];

const closeDayReady = (
  <CloseDayCardView thisTillShiftOpen={false} pending={false} error={null} nextBusinessDate={null} onCloseDay={nothing} />
);

function OpenShift(props: Partial<Parameters<typeof OpenShiftView>[0]>) {
  return (
    <AccessFrame>
      <OpenShiftView
        person={{ name: "Amina Hassan", initials: "AH" }}
        tillName="Main Restaurant"
        currency={CURRENCY}
        canOpenShift
        pending={false}
        error={null}
        closed={null}
        closeDay={null}
        onSwitchPerson={nothing}
        onOpen={nothing}
        {...props}
      />
    </AccessFrame>
  );
}

/** NO_SHIFT: a cashier opening the shift. */
export function NoShiftFixture() {
  return <OpenShift />;
}

/** NO_SHIFT after a close, for a manager: Yetu's result and Close the day. */
export function OpenShiftManagerFixture() {
  return (
    <OpenShift
      closed={{
        shift: { ...SHIFT, status: "CLOSED", countedCashMinor: 7_450_000, varianceMinor: 50_000 },
        currency: CURRENCY,
        at: new Date(2026, 9, 12, 22, 14),
      }}
      closeDay={closeDayReady}
    />
  );
}

/** NO_SHIFT after a manager closed the day: the new business day, nothing to press again. */
export function DayClosedFixture() {
  return (
    <OpenShift
      closeDay={
        <CloseDayCardView thisTillShiftOpen={false} pending={false} error={null} nextBusinessDate="2026-10-13" onCloseDay={nothing} />
      }
    />
  );
}

/** NO_SHIFT for someone who may not open it. */
export function OpenShiftNoPermissionFixture() {
  return <OpenShift canOpenShift={false} />;
}

/** NO_SHIFT: a manager's day close refused because other tills are open. */
export function DayCloseBlockedFixture() {
  return (
    <OpenShift
      closeDay={
        <CloseDayCardView
          thisTillShiftOpen={false}
          pending={false}
          error={new Error(JSON.stringify({ code: "INVALID_STATE", detail: "a shift for this business date is still open: 2 shift(s) for 2026-10-12" }))}
          nextBusinessDate={null}
          onCloseDay={nothing}
        />
      }
    />
  );
}

/** Counting the float note by note. */
export function NoteCounterFixture() {
  return <OpenShift initialNoteCounter />;
}

function Cash(props: Partial<Parameters<typeof CashView>[0]>) {
  return (
    <FixtureShell initialPage="manager">
      <CashView
        shift={SHIFT}
        currency={CURRENCY}
        movements={MOVEMENTS}
        roster={ROSTER}
        canRecordCash
        canCloseShift
        showExpected
        closeDay={
          <CloseDayCardView thisTillShiftOpen pending={false} error={null} nextBusinessDate={null} onCloseDay={nothing} />
        }
        onCashIn={nothing}
        onCashOut={nothing}
        onCloseShift={nothing}
        {...props}
      />
    </FixtureShell>
  );
}

/** Manager -> Printers (S8a/S8b): paper kitchen tickets, the kitchen and receipt printers, the drawer. */
export function PrintersFixture() {
  return <Cash printers={<PrintersCard />} />;
}

/** Cash for a manager: the drawer, cash in and out, close shift, close the day. */
export function CashFixture() {
  return <Cash />;
}

/** Cash for a cashier: cash in and out and Close shift, and no expected figure (the count stays blind). */
export function CashCashierFixture() {
  return <Cash showExpected={false} closeDay={null} />;
}

/** Cash for someone with none of the cash permissions: no expected figure either. */
export function CashNoPermissionFixture() {
  return <Cash canRecordCash={false} canCloseShift={false} showExpected={false} closeDay={null} />;
}

/** Recording cash in. */
export function CashInFixture() {
  return (
    <Cash>
      <CashMovementSheetView
        onClose={nothing}
        currency={CURRENCY}
        initialType="CASH_IN"
        roster={ROSTER}
        requesterId={AMINA}
        pending={false}
        error={null}
        onRecord={nothing}
        initialAmount="10000"
        initialReason="Float top-up from the safe"
      />
    </Cash>
  );
}

/** Taking cash out: a different supervisor approves. */
export function CashOutFixture() {
  return (
    <Cash>
      <CashMovementSheetView
        onClose={nothing}
        currency={CURRENCY}
        initialType="CASH_OUT"
        roster={ROSTER}
        requesterId={AMINA}
        pending={false}
        error={null}
        onRecord={nothing}
        initialAmount="20000"
        initialReason="Gas delivery"
      />
    </Cash>
  );
}

const NO_TABS = { count: 0, owedMinor: 0 };

/** Closing over a cashier's Cash page: the usual closer, and the count stays blind behind the sheet. */
function Close(props: Partial<Parameters<typeof CloseShiftSheetView>[0]>) {
  return (
    <Cash showExpected={false} closeDay={null}>
      <CloseShiftSheetView
        open
        onOpenChange={nothing}
        shift={SHIFT}
        currency={CURRENCY}
        requesterId={AMINA}
        roster={ROSTER}
        openTabs={NO_TABS}
        onClose={async () => SHIFT}
        {...props}
      />
    </Cash>
  );
}

/** Close shift, step 1: the blind count. */
export function CloseCountFixture() {
  return <Close />;
}

/** Close shift, step 2: the count matches. */
export function CloseBalancedFixture() {
  return <Close initialCounted="74000" initialStep="check" />;
}

/** Close shift with tabs still open (S17b): they go to the next shift, and the button says so. */
export function CloseTabsFixture() {
  return <Close initialCounted="74000" initialStep="check" openTabs={{ count: 2, owedMinor: 4_520_000 }} />;
}

/** Close shift, step 2: over, so a manager approves. */
export function CloseOverFixture() {
  return <Close initialCounted="74500" initialStep="check" />;
}

/** Cash out after too many approvals in an hour (429): the words, and Record waits until Yetu allows it. */
export function CashOutRateLimitedFixture() {
  return (
    <Cash>
      <CashMovementSheetView
        onClose={nothing}
        currency={CURRENCY}
        initialType="CASH_OUT"
        roster={ROSTER}
        requesterId={AMINA}
        pending={false}
        waiting
        error={
          new Error(
            JSON.stringify({ type: "about:blank", title: "Too many requests.", status: 429, code: "RATE_LIMITED", detail: "Too many requests. Try again in 41 seconds.", request_id: "req-7", retryAfterSeconds: 41 }),
          )
        }
        onRecord={nothing}
        initialAmount="20000"
        initialReason="Gas delivery"
      />
    </Cash>
  );
}
