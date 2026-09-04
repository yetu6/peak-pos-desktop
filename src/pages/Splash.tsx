import { Icon } from "../components/Icon";

/**
 * The one screen every normal launch begins with (PEAK_TERMINAL_MASTER_OPERATIONS.md
 * §8.1). It communicates calm progress — never implementation detail, never a
 * raw percentage or step count — while the native core runs its startup
 * checks (§8.2) behind it.
 */
export function Splash() {
  return (
    <div
      className="flex h-screen flex-col items-center justify-center gap-6 bg-[var(--background)]"
      data-testid="splash-screen"
    >
      <div className="flex flex-col items-center gap-3">
        <Icon name="peak-logo" size={40} className="text-[var(--gold-accent)]" />
        <div className="flex flex-col items-center leading-none">
          <span className="text-lg font-medium tracking-wide text-[var(--foreground-muted)]">
            Peak
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
