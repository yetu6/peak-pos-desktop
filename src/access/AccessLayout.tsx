import { useEffect, useId, useState, type ReactNode } from "react";
import { BrandLockup } from "../components/BrandLockup";
import { PlaceMark } from "../components/PlaceMark";
import { placeTitle, type TillPlace } from "../lib/tillPlace";
import { cn } from "../lib/utils";
import { clockTime, longDayWords } from "../lib/words";

/** The time and the day on the hotel pane, kept to the minute. */
function useNow(fixed?: Date): Date {
  const [now, setNow] = useState(() => fixed ?? new Date());
  useEffect(() => {
    if (fixed) return;
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, [fixed]);
  return fixed ?? now;
}

/**
 * The frame for every screen before a person is signed in: the hotel's pane
 * (its mark and names, the time and the day, and Yetu small at its foot) and
 * the step on the canvas beside it. A till that belongs to no hotel yet
 * (setup, pairing) shows Yetu in the pane instead. Each step rises into place
 * as it changes (Who's working, then the PIN); reduced motion keeps it still.
 * Banners (update, key storage) sit above it in the app's access frame.
 */
export function AccessLayout({
  testId,
  title,
  lede,
  place = {},
  width = "regular",
  notice,
  now,
  children,
}: {
  testId: string;
  title: string;
  lede?: ReactNode;
  /** The hotel, the outlet and the till, as Yetu last named them (F-252). */
  place?: TillPlace;
  width?: "regular" | "wide";
  /** A notice above the panel's content (offline, session ended). */
  notice?: ReactNode;
  /** Fixtures show a fixed time. */
  now?: Date;
  children: ReactNode;
}) {
  const headingId = useId();
  const moment = useNow(now);
  const named = placeTitle(place) !== null;
  return (
    <div className="y-access" data-testid={testId}>
      <aside className="y-access__brand" aria-label="This till">
        {named ? (
          <PlaceMark place={place} size="pane" data-testid="till-name" />
        ) : (
          <BrandLockup height={40} className="brand-lockup--on-dark" />
        )}
        <div className="y-access__time">
          <span className="y-access__clock" data-testid="access-clock">
            {clockTime(moment)}
          </span>
          <span className="y-access__day">{longDayWords(moment)}</span>
        </div>
        {named ? <BrandLockup height={20} className="brand-lockup--on-dark y-access__yetu" /> : null}
      </aside>
      <main className="y-access__main">
        <section
          key={title}
          className={cn("y-access__panel", "y-access__step", `y-access__panel--${width}`)}
          aria-labelledby={headingId}
        >
          <h1 id={headingId} className="y-access__title">
            {title}
          </h1>
          {lede ? <div className="y-access__lede">{lede}</div> : null}
          {notice ? <div className="y-access__notice">{notice}</div> : null}
          {children}
        </section>
      </main>
    </div>
  );
}

/** The frame the app puts around the access screens: banners first, then the screen. */
export function AccessFrame({ banners, children }: { banners?: ReactNode; children: ReactNode }) {
  return (
    <div className="y-access-frame">
      <div className="y-banners">{banners}</div>
      {/* The screen fits the window at every supported size; only lists scroll inside themselves. */}
      <div className="y-access-frame__screen" data-must-fit="">
        {children}
      </div>
    </div>
  );
}
