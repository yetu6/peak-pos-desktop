import { useState, type ReactNode } from "react";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { AccessLayout } from "../access/AccessLayout";
import { differenceWords } from "../cash/cashWords";
import { CloseDayCard } from "../cash/CloseDayCard";
import { forgetClosedShift, useLastClosedShift, type ClosedShift } from "../cash/closedShift";
import { NoteCounterSheet, denominationsFor, moneyFieldText } from "../cash/NoteCounterSheet";
import { Button, Money, MoneyField, PermissionNotice } from "../components/system";
import {
  useCatalogCurrency,
  useHasCapability,
  useHasPermission,
  useIdempotencyKey,
  useMutationMessage,
  usePosShift,
} from "../hooks/usePosData";
import { toMinor } from "../lib/posMoney";
import { personLabel } from "../lib/staffLabel";
import { clockTime } from "../lib/words";

/**
 * No shift is open on this till: count the drawer and open one. Reuses the
 * same usePosShift() mutation as before so opening stays one contract. After
 * a close, the result Yetu returned is shown here (the Done step), and a
 * manager can close the business day.
 */
export function OpenShiftScreen() {
  const { session, identity, switchStaff, roster } = useDeviceSession();
  const { open } = usePosShift();
  const currency = useCatalogCurrency();
  const canOpenShift = useHasPermission("pos.shift.open");
  const isManager = useHasPermission("pos.report.manager");
  const hotel = useHasCapability("LODGING");
  const openError = useMutationMessage(open.error);
  const openKey = useIdempotencyKey();
  const closed = useLastClosedShift();
  return (
    <OpenShiftView
      person={personLabel(session?.staffId, roster)}
      tillName={identity?.terminalName?.trim() || null}
      currency={currency}
      canOpenShift={canOpenShift}
      pending={open.isPending}
      error={openError}
      closed={closed}
      closeDay={isManager && !hotel ? <CloseDayCard thisTillShiftOpen={false} /> : null}
      onSwitchPerson={() => switchStaff()}
      onOpen={(openingCashMinor) => {
        open.mutate({ openingCashMinor, idempotencyKey: openKey.next() });
        forgetClosedShift();
      }}
    />
  );
}

export interface OpenShiftViewProps {
  person: { name: string; initials: string };
  tillName: string | null;
  currency: string | undefined;
  canOpenShift: boolean;
  pending: boolean;
  error: string | null;
  /** The shift this till just closed, as Yetu returned it. */
  closed: ClosedShift | null;
  /** The Close the day card, for managers on a restaurant-only property. */
  closeDay: ReactNode;
  onSwitchPerson: () => void;
  onOpen: (openingCashMinor: number) => void;
  /** Fixtures start part-way through. */
  initialNoteCounter?: boolean;
}

export function OpenShiftView({
  person,
  tillName,
  currency,
  canOpenShift,
  pending,
  error: openError,
  closed,
  closeDay,
  onSwitchPerson,
  onOpen,
  initialNoteCounter = false,
}: OpenShiftViewProps) {
  const [openingFloat, setOpeningFloat] = useState("");
  const [noteCounter, setNoteCounter] = useState(initialNoteCounter);
  const openingMinor = toMinor(openingFloat);
  // A second column only when there is something to put in it.
  const aside = closed !== null || Boolean(closeDay);

  function submit(): void {
    if (openingMinor == null || pending) return;
    onOpen(openingMinor);
  }

  return (
    <AccessLayout
      testId="open-shift-screen"
      title="Open the shift"
      tillName={tillName}
      width={aside ? "wide" : "regular"}
    >
      <div className={aside ? "y-open-shift" : undefined}>
        <div className="y-access__column">
          <div className="y-pin__who">
            <span className="y-pin__person">
              <span className="y-avatar" aria-hidden="true">
                {person.initials}
              </span>
              <span className="y-pin__who-name" data-testid="shift-staff-name">
                {person.name}
              </span>
            </span>
            <Button variant="quiet" data-testid="open-shift-switch-staff" onClick={onSwitchPerson}>
              Switch person
            </Button>
          </div>

          {canOpenShift ? (
            <form
              className="y-form"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <MoneyField
                label="Count the cash in the drawer"
                hint="This is the float the shift starts with."
                currency={currency}
                value={openingFloat}
                onValueChange={(text) => setOpeningFloat(text)}
                inputTestId="opening-float"
                autoFocus
              />
              {denominationsFor(currency).length > 0 ? (
                <Button variant="secondary" onClick={() => setNoteCounter(true)}>
                  Count note by note
                </Button>
              ) : null}
              {openError ? (
                <p className="y-pin__message" role="alert" data-testid="open-shift-error">
                  {openError}
                </p>
              ) : null}
              <Button
                type="submit"
                variant="primary"
                size={64}
                block
                data-testid="open-shift"
                disabled={pending || openingMinor == null}
              >
                {pending ? "Opening the shift…" : "Open shift"}
              </Button>
            </form>
          ) : (
            <div data-testid="open-shift-unavailable">
              <PermissionNotice who="a cashier or manager" action="open the shift" next="Ask one to open it." />
            </div>
          )}
        </div>

        {aside ? (
          <div className="y-access__column">
            {closed ? (
              <section className="y-cash__card" data-testid="closed-shift-summary" aria-labelledby="closed-title">
                <h2 id="closed-title" className="y-cash__card-title">
                  Shift closed at {clockTime(closed.at)}
                </h2>
                <dl className="y-cash__summary y-cash__summary--compact">
                  <div>
                    <dt>Expected</dt>{" "}
                    <dd>
                      <Money minor={closed.shift.expectedCashMinor} currency={closed.currency} size="lead" />
                    </dd>
                  </div>
                  <div>
                    <dt>Counted</dt>{" "}
                    <dd>
                      <Money minor={closed.shift.countedCashMinor} currency={closed.currency} size="lead" />
                    </dd>
                  </div>
                </dl>
                <p className="y-cash__result">
                  {closed.shift.varianceMinor != null && closed.currency
                    ? differenceWords(closed.shift.varianceMinor, closed.currency)
                    : "Closed"}
                </p>
              </section>
            ) : null}
            {closeDay}
          </div>
        ) : null}
      </div>
      {currency ? (
        <NoteCounterSheet
          open={noteCounter}
          onOpenChange={setNoteCounter}
          currency={currency}
          onUse={(minor) => setOpeningFloat(moneyFieldText(minor))}
        />
      ) : null}
    </AccessLayout>
  );
}
