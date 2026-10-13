import { useId, type ReactNode } from "react";
import { BrandLockup } from "../components/BrandLockup";
import { cn } from "../lib/utils";

/**
 * The frame for every screen before a person is signed in: the brand and the
 * till's name at the top, one panel with a heading in the middle. Banners
 * (update, key storage) sit above it in the app's access frame.
 */
export function AccessLayout({
  testId,
  title,
  lede,
  tillName,
  width = "regular",
  notice,
  children,
}: {
  testId: string;
  title: string;
  lede?: ReactNode;
  tillName?: string | null;
  width?: "regular" | "wide";
  /** A notice above the panel's content (offline, session ended). */
  notice?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <div className="y-access" data-testid={testId}>
      <header className="y-access__top">
        <BrandLockup height={28} />
        {tillName ? (
          <span className="y-access__till" data-testid="till-name">
            {tillName}
          </span>
        ) : null}
      </header>
      <main className="y-access__main">
        <section className={cn("y-access__panel", `y-access__panel--${width}`)} aria-labelledby={headingId}>
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
