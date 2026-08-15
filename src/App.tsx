import { useEffect, useState } from "react";
import { Icon } from "./components/Icon";
import { ConnectivityIndicator } from "./components/ConnectivityIndicator";
import { ThemeToggle } from "./components/ThemeToggle";
import { ActiveOrders } from "./pages/ActiveOrders";
import { Kitchen } from "./pages/Kitchen";
import { useRealtimeEvents } from "./realtime/RealtimeProvider";
import { useOutletId } from "./hooks/usePosData";

type Page = "orders" | "kitchen";

const NAV: Array<{ page: Page; label: string; icon: "orders" | "kitchen" }> = [
  { page: "orders", label: "Active Orders", icon: "orders" },
  { page: "kitchen", label: "Kitchen", icon: "kitchen" },
];

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function App() {
  const [page, setPage] = useState<Page>("orders");
  const outletId = useOutletId();
  const clock = useClock();
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  useRealtimeEvents(
    { kind: "outletOrders", outletId },
    (event) => setLastEvent(`${event.type} #${event.aggregateVersion ?? "?"}`),
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Dark POS sidebar (Safari POS: #032421) */}
      <aside className="flex w-60 shrink-0 flex-col bg-[var(--color-pos-sidebar)]">
        <div className="flex h-14 items-center gap-2 px-4">
          <Icon name="peak-logo" size={22} className="text-[#D4A017]" />
          <span className="font-display text-lg text-white">Peak POS</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV.map((item) => (
            <button
              key={item.page}
              data-testid={`nav-${item.page}`}
              onClick={() => setPage(item.page)}
              className={`flex h-10 w-full items-center gap-3 border-l-[3px] px-4 text-left text-sm transition-colors ${
                page === item.page
                  ? "border-[var(--color-gold)] bg-black/20 font-medium text-white"
                  : "border-transparent text-[rgba(255,255,255,0.65)] hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 px-2 py-1">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-brand)] text-xs font-semibold text-white">
              OP
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-white">Operator</div>
              <div className="truncate text-[11px] text-[rgba(255,255,255,0.5)]">
                outlet {outletId.slice(0, 8)}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass flex h-14 shrink-0 items-center gap-4 border-b border-[var(--color-border)] px-5">
          <span className="text-[13px] font-semibold text-[var(--color-text-secondary)]">
            {clock}
          </span>
          <span className="h-5 w-px bg-[var(--color-border)]" />
          <div className="min-w-0 flex-1">
            {lastEvent && (
              <span
                className="truncate text-[11px] text-[var(--color-text-muted)]"
                data-testid="last-event"
              >
                last event: {lastEvent}
              </span>
            )}
          </div>
          <ThemeToggle />
          <ConnectivityIndicator />
        </header>

        <main className="flex-1 overflow-auto p-6">
          {page === "orders" ? <ActiveOrders /> : <Kitchen />}
        </main>
      </div>
    </div>
  );
}