import { useState, type ReactNode } from "react";
import { placeOf, type TillPlace } from "../lib/tillPlace";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { AccessLayout } from "../access/AccessLayout";
import { differenceWords, handedOverWords, openShiftProblem } from "../cash/cashWords";
import { CloseDayCard } from "../cash/CloseDayCard";
import { forgetClosedShift, useLastClosedShift, type ClosedShift } from "../cash/closedShift";
import { NoteCounterSheet, denominationsFor, moneyFieldText } from "../cash/NoteCounterSheet";
import { Avatar, Button, Money, MoneyField, PermissionNotice, type Refusal } from "../components/system";
import {
  useCatalogCurrency,
  useHasCapability,
  useHasPermission,
  useIdempotencyKey,
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
  const openError = openShiftProblem(open.error);
  const openKey = useIdempotencyKey();
  const closed = useLastClosedShift();
  return (
    <OpenShiftView
      person={personLabel(session?.staffId, roster)}
      place={placeOf(identity)}
      currency={currency}
      canOpenShift={canOpenShift}
      pending={open.isPending}
      error={openError}
      closed={closed}
      closeDay={isManager && !hotel ? <CloseDayCard thisTillShiftOpen={false} /> : null}
      onSwitchPerson={() => {
        // The last shift's result is for the person who closed it.
        forgetClosedShift();
        switchStaff();
      }}
      onOpen={(openingCashMinor) => {
        // The summary goes only once the new shift is open. A refusal keeps it
        // on screen; its words come from open.error above.
        open.mutateAsync({ openingCashMinor, idempotencyKey: openKey.next() }).then(forgetClosedShift, () => undefined);
      }}
    />
  );
}

export interface OpenShiftViewProps {
  person: { name: string; initials: string };
  /** The hotel, the outlet and the till (F-252). */
  place: TillPlace;
  currency: string | undefined;
  canOpenShift: boolean;
  pending: boolean;
  /** Why Yetu didn't open it: a 403 shows as a permission notice. */
  error: Refusal | string | null;
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
  place,
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
      place={place}
      width={aside ? "wide" : "regular"}
    >
      <div className={aside ? "y-open-shift" : undefined}>
        <div className="y-access__column">
          <div className="y-pin__who">
            <span className="y-pin__person">
              <Avatar name={person.name} initials={person.initials} />
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
                typeof openError !== "string" && openError.kind === "permission" ? (
                  <div data-testid="open-shift-error">
                    <PermissionNotice live words={openError.words} />
                  </div>
                ) : (
                  <p className="y-pin__message" role="alert" data-testid="open-shift-error">
                    {typeof openError === "string" ? openError : openError.words}
                  </p>
                )
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
                {handedOverWords(closed.shift.handedOverTabs, closed.shift.handedOverOwedMinor, closed.currency) ? (
                  <p className="y-cash__muted" data-testid="closed-shift-tabs">
                    {handedOverWords(closed.shift.handedOverTabs, closed.shift.handedOverOwedMinor, closed.currency)}
                  </p>
                ) : null}
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
