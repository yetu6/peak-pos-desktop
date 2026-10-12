import { CircleCheck, CircleDot, CircleX } from "lucide-react";
import { Banner, Button } from "../components/system";
import { useCloseBusinessDay, useIdempotencyKey } from "../hooks/usePosData";
import { businessDayWords } from "../lib/words";
import { dayCloseProblem } from "./cashWords";

/**
 * Close the business day (pos.report.manager, restaurant-only properties).
 * The till knows only its own shift; Yetu checks every other till and any
 * cash taken without internet when the day is closed, and says what blocks
 * it. The call is the existing one.
 */
export function CloseDayCard({ thisTillShiftOpen }: { thisTillShiftOpen: boolean }) {
  const closeDay = useCloseBusinessDay();
  const dayCloseKey = useIdempotencyKey();
  return (
    <CloseDayCardView
      thisTillShiftOpen={thisTillShiftOpen}
      pending={closeDay.isPending}
      error={closeDay.error}
      nextBusinessDate={closeDay.data?.nextBusinessDate ?? null}
      onCloseDay={() => closeDay.mutate(dayCloseKey.next())}
    />
  );
}

export function CloseDayCardView({
  thisTillShiftOpen,
  pending,
  error,
  nextBusinessDate,
  onCloseDay,
}: {
  thisTillShiftOpen: boolean;
  pending: boolean;
  error: unknown;
  /** Set once Yetu has closed the day. */
  nextBusinessDate: string | null;
  onCloseDay: () => void;
}) {
  const problem = dayCloseProblem(error);
  const nextDay = nextBusinessDate ? businessDayWords(nextBusinessDate) : "";

  // Once Yetu has closed the day, the card shows that and nothing to press:
  // a second tap could otherwise close the next day too.
  if (nextBusinessDate) {
    return (
      <section className="y-cash__card" data-testid="close-day" aria-labelledby="close-day-title">
        <h2 id="close-day-title" className="y-cash__card-title">
          Close the day
        </h2>
        <div data-testid="day-close-result">
          <Banner inline tone="success">
            Day closed. The new business day is <span className="y-cash__nowrap">{nextDay || "set"}</span>.
          </Banner>
        </div>
      </section>
    );
  }

  return (
    <section className="y-cash__card" data-testid="close-day" aria-labelledby="close-day-title">
      <h2 id="close-day-title" className="y-cash__card-title">
        Close the day
      </h2>
      <p className="y-cash__muted">Closing the day starts the next business day for every till here.</p>
      <ul className="y-checklist" aria-label="Before the day closes">
        <li className={thisTillShiftOpen ? "y-checklist__no" : "y-checklist__yes"}>
          {thisTillShiftOpen ? <CircleX aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
          <span>
            This till's shift is closed
            {thisTillShiftOpen ? <span className="y-checklist__why">Close this till's shift first.</span> : null}
          </span>
        </li>
        <li>
          <CircleDot aria-hidden="true" />
          <span>
            Every other till's shift is closed
            <span className="y-checklist__why">Yetu checks this when you close the day.</span>
          </span>
        </li>
        <li>
          <CircleDot aria-hidden="true" />
          <span>
            Cash taken without internet has been sent
            <span className="y-checklist__why">Yetu checks this too.</span>
          </span>
        </li>
      </ul>
      {problem ? (
        <div data-testid="day-close-error">
          <Banner inline tone="danger">{problem.words}</Banner>
        </div>
      ) : null}
      <Button
        variant="primary"
        size={56}
        data-testid="close-business-day"
        disabled={thisTillShiftOpen || pending}
        onClick={onCloseDay}
      >
        {pending ? "Closing the day…" : "Close the day"}
      </Button>
    </section>
  );
}
