import { BrandLockup } from "../components/BrandLockup";

/**
 * The one screen every normal launch begins with. It communicates calm
 * progress — never implementation detail, never a raw percentage or step
 * count — while the native core runs its startup checks behind it.
 */
export function Splash() {
  return (
    <div
      className="flex h-screen flex-col items-center justify-center gap-6 bg-[var(--background)]"
      data-testid="splash-screen"
    >
      <div className="flex flex-col items-center gap-3">
        <BrandLockup height={40} />
        <div className="flex flex-col items-center leading-none">
          <span className="text-lg font-medium tracking-wide text-[var(--foreground-muted)]">
            POS
          </span>
          <span className="text-2xl font-semibold tracking-[0.2em] text-[var(--foreground)]">
            TERMINAL
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-[var(--foreground-muted)]">
          Preparing this terminal
        </span>
        <span className="splash-progress" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  );
}
