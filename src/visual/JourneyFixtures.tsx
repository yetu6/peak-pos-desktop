import { Icon } from "../components/Icon";
import { Splash } from "../pages/Splash";

/**
 * Development-only, deterministic compositions of the pre-authentication
 * Peak Terminal journey (PEAK_TERMINAL_MASTER_OPERATIONS.md §7-11), captured
 * from the real Tauri/WebKit rendering path exactly like PeakTerminalFixture
 * captures the operational register. These reuse the real screens' own
 * markup and CSS classes with static data standing in for a live backend --
 * never the live `PairingScreen`/`PinUnlock`/`OpenShiftScreen` components
 * directly, since those require a real `DeviceSessionProvider` (native
 * Tauri IPC) that only resolves to LOCKED/NO_SHIFT after this terminal has
 * actually been paired against a running Peak backend at least once.
 */

/** STARTING -- the real, hook-free Splash screen, unmodified. */
export function SplashFixture() {
  return <Splash />;
}

/** UNPROVISIONED/PAIRING -- before a pairing code has been requested. */
export function PairingFixture() {
  return (
    <div className="auth-shell flex h-screen items-center justify-center p-6" data-testid="pairing-screen">
      <div className="glass-panel w-full max-w-lg p-8">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Icon name="peak-logo" size={28} className="text-[var(--gold-accent)]" />
          <span className="font-display text-2xl text-[var(--foreground)]">Pair this terminal</span>
        </div>
        <p className="text-sm text-[var(--foreground-muted)]">
          This terminal starts with no hotel authority. Generate a short-lived code, then ask an
          authorized manager to bind it to the correct property and outlet.
        </p>
        <button className="btn-primary mt-6 w-full">Generate pairing code</button>
      </div>
    </div>
  );
}

/** PAIRING -- after a code has been requested, waiting for manager approval. */
export function PairingWaitingFixture() {
  return (
    <div className="auth-shell flex h-screen items-center justify-center p-6" data-testid="pairing-screen">
      <div className="glass-panel w-full max-w-lg p-8">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Icon name="peak-logo" size={28} className="text-[var(--gold-accent)]" />
          <span className="font-display text-2xl text-[var(--foreground)]">Pair this terminal</span>
        </div>
        <p className="text-sm text-[var(--foreground-muted)]">
          Ask an authorized property manager to approve this terminal using the pairing code.
        </p>
        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-interactive)] p-5 text-center">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
            Pairing code
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold tracking-[0.16em] text-[var(--foreground)]">
            7F3K-Q9
          </div>
          <div className="mt-3 break-all text-[11px] text-[var(--foreground-muted)]">
            SHA256:3f9a2b…c81d
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-[var(--foreground-muted)]">Waiting for manager approval…</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button className="btn-primary">Check approval</button>
          <button className="btn-secondary">Start over</button>
        </div>
      </div>
    </div>
  );
}

const ROSTER = [
  { name: "Amina Hassan", initials: "AH" },
  { name: "Grace Mushi", initials: "GM" },
  { name: "Juma Ally", initials: "JA" },
] as const;

/** LOCKED -- tap-to-select staff roster, the front door of every restart. */
export function LockedRosterFixture() {
  return (
    <div className="auth-shell flex h-screen items-center justify-center p-6" data-testid="pin-screen">
      <div className="glass-panel w-full max-w-xl p-8">
        <div className="mb-5 flex items-center justify-center gap-2">
          <Icon name="peak-logo" size={24} className="text-[var(--gold-accent)]" />
          <span className="font-display text-xl text-[var(--foreground)]">Peak Terminal</span>
        </div>
        <p className="text-center text-[13px] font-medium text-[var(--foreground-muted)]">Main restaurant</p>
        <p className="mt-2 text-center text-[11px] font-medium text-[var(--foreground-muted)]">Offline authority ready</p>
        <p className="mt-5 text-center text-sm font-medium text-[var(--foreground)]">Who's using this terminal?</p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {ROSTER.map((entry) => (
            <button
              key={entry.name}
              className="flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-[var(--radius-tile)] border border-[var(--border)] p-3 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-interactive)]"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-interactive)] text-base font-semibold text-[var(--foreground)]">
                {entry.initials}
              </span>
              <span className="text-center text-[13px] font-medium leading-tight text-[var(--foreground)]">
                {entry.name}
              </span>
            </button>
          ))}
        </div>
        <button className="mt-4 h-11 w-full text-center text-[12px] font-medium text-[var(--foreground-muted)] underline">
          Enter staff number instead
        </button>
      </div>
    </div>
  );
}

/** LOCKED -- PIN pad after a name has been chosen from the roster. */
export function LockedPinFixture() {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"];
  return (
    <div className="auth-shell flex h-screen items-center justify-center p-6" data-testid="pin-screen">
      <div className="glass-panel w-full max-w-sm p-8">
        <div className="mb-5 flex items-center justify-center gap-2">
          <Icon name="peak-logo" size={24} className="text-[var(--gold-accent)]" />
          <span className="font-display text-xl text-[var(--foreground)]">Peak Terminal</span>
        </div>
        <p className="text-center text-[13px] font-medium text-[var(--foreground-muted)]">Main restaurant</p>
        <div className="mt-5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium text-[var(--foreground-muted)]">Signing in as</p>
            <p className="text-sm font-semibold text-[var(--foreground)]">Amina Hassan</p>
          </div>
          <button className="text-[12px] font-medium text-[var(--foreground-muted)] underline">Not you?</button>
        </div>
        <label className="mt-3 block text-[11px] font-medium text-[var(--foreground-muted)]">PIN</label>
        <div className="mt-1 flex h-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-interactive)] font-mono text-lg tracking-[0.4em] text-[var(--foreground)]">
          ••••
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {keys.map((key) => (
            <button
              key={key}
              className="h-12 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-interactive)]"
            >
              {key}
            </button>
          ))}
        </div>
        <button className="btn-primary mt-5 w-full">Unlock</button>
      </div>
    </div>
  );
}

/** NO_SHIFT -- an authenticated staff member with no open shift on this register. */
export function NoShiftFixture() {
  return (
    <div className="auth-shell flex h-screen items-center justify-center p-6" data-testid="open-shift-screen">
      <div className="glass-panel w-full max-w-sm p-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-interactive)] text-sm font-semibold text-[var(--foreground)]">
              AH
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-[var(--foreground)]">Amina Hassan</p>
              <p className="text-[12px] text-[var(--foreground-muted)]">Main restaurant</p>
            </div>
          </div>
          <button className="btn-tertiary !h-9 !w-9 !p-0" aria-label="Switch staff">
            <Icon name="logout" size={16} />
          </button>
        </div>
        <p className="mt-6 text-center text-sm font-medium text-[var(--foreground)]">
          No shift is open on this register
        </p>
        <label className="mt-6 block text-[11px] font-medium text-[var(--foreground-muted)]">Opening float</label>
        <input className="input mt-1 w-full text-lg" placeholder="0" defaultValue="" readOnly />
        <button className="btn-primary mt-5 w-full">Open shift</button>
      </div>
    </div>
  );
}
