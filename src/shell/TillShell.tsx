import {
  Activity,
  Ban,
  Banknote,
  ChefHat,
  Clock,
  Info,
  Lock,
  LogOut,
  Moon,
  ReceiptText,
  Search,
  ShoppingBasket,
  Sun,
  UsersRound,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShiftSafeUpdater } from "../hooks/useShiftSafeUpdater";
import { PlaceMark } from "../components/PlaceMark";
import { Button, KeyHint, StatusChip } from "../components/system";
import { ThemeToggle } from "../components/ThemeToggle";
import { normalizeMode } from "../lib/displayDefaults";
import { globalCommandFor, keyHintFor, keyHintForCommand } from "../lib/keyboard";
import { chooseTheme, useTheme } from "../lib/theme";
import type { TillPlace } from "../lib/tillPlace";
import { cn } from "../lib/utils";
import { isDisplayMode, railNav, type RailItem, type WorkspacePage } from "../lib/workspace";
import { CommandSearch, type ShellCommand } from "./CommandSearch";
import { PersonMenu } from "./PersonMenu";

/** Named setting: how long a closed section's reason stays on screen. */
export const RAIL_REASON_VISIBLE_MS = 6_000;

const RAIL_ICON: Record<WorkspacePage, typeof Activity> = {
  new: ShoppingBasket,
  orders: ReceiptText,
  kitchen: ChefHat,
  manager: Banknote,
  status: Activity,
};

/** What each section is for, and what people call the jobs in it, for the command search. */
const SECTION_SEARCH: Record<WorkspacePage, { description: string; keywords: string[] }> = {
  new: { description: "Take an order and get paid", keywords: ["sell", "new order", "new sale", "menu", "register", "pay"] },
  orders: { description: "Open and paid orders", keywords: ["orders", "open orders", "find an order", "receipt", "paid"] },
  kitchen: { description: "Tickets for the kitchen and bar", keywords: ["kitchen", "bar", "tickets", "preparing", "ready"] },
  manager: {
    description: "Cash in and out, close the shift and the day",
    keywords: ["cash", "cash in", "cash out", "drawer", "float", "close shift", "close the day", "close day"],
  },
  status: {
    description: "Printer, connection and help",
    keywords: ["status", "printer", "print test page", "connection", "internet", "help"],
  },
};

export interface TillShellProps {
  /** The mode a manager chose at pairing (POS, CASHIER, KITCHEN_DISPLAY, BAR_DISPLAY). */
  mode?: string | null;
  /** Working offline: cash only, sections that need the connection are closed. */
  offlineCash?: boolean;
  page: WorkspacePage;
  onNavigate: (page: WorkspacePage) => void;
  /** The hotel, the outlet and the till, as the manager named them in Yetu (F-252). */
  place?: TillPlace;
  person: { name: string; initials: string };
  /** The shift and its business day in words, in full and shorter for compact screens. */
  shift?: { full: string; short: string } | null;
  clock: string;
  /** The connection and sync chip. */
  connection: ReactNode;
  /** Update, key storage, session and offline notices: under the top bar, never over the work. */
  banners?: ReactNode;
  onSwitchPerson: () => void;
  onLock: () => void;
  /** "full" lets a screen use the whole work area (Sell); "padded" gives it a margin. */
  workspaceVariant?: "padded" | "full";
  children: ReactNode;
}

/** Another dialog is open (a payment, a void): the section keys wait until it closes. */
function otherDialogOpen(): boolean {
  return Boolean(
    document.querySelector('[role="dialog"][data-state="open"]:not([data-command-search]), [role="alertdialog"]'),
  );
}

/**
 * The till's frame: a 52px top bar, a 76px rail (64px on compact screens) and
 * the work area, with banners between the top bar and everything else.
 * Kitchen and bar displays get the top bar and the work area only.
 */
export function TillShell({
  mode,
  offlineCash = false,
  page,
  onNavigate,
  place = {},
  person,
  shift,
  clock,
  connection,
  banners,
  onSwitchPerson,
  onLock,
  workspaceVariant = "padded",
  children,
}: TillShellProps) {
  const display = isDisplayMode(mode);
  const rail = useMemo(() => railNav(mode, { offlineCash }), [mode, offlineCash]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [personMenuOpen, setPersonMenuOpen] = useState(false);
  const [reason, setReason] = useState<{ page: WorkspacePage; text: string; top: number } | null>(null);
  const reasonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { theme } = useTheme();
  const updateReady = useShiftSafeUpdater().status.kind === "ready";

  useEffect(() => () => {
    if (reasonTimer.current) clearTimeout(reasonTimer.current);
  }, []);

  const go = useCallback(
    (target: WorkspacePage) => {
      const item = rail.find((entry) => entry.page === target);
      if (!item) return;
      if (item.disabledReason) {
        const anchor = document.querySelector(`[data-testid="nav-${target}"]`);
        const top = anchor ? anchor.getBoundingClientRect().top : 0;
        setReason({ page: target, text: item.disabledReason, top });
        if (reasonTimer.current) clearTimeout(reasonTimer.current);
        reasonTimer.current = setTimeout(() => setReason(null), RAIL_REASON_VISIBLE_MS);
        return;
      }
      setReason(null);
      onNavigate(target);
    },
    [rail, onNavigate],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.defaultPrevented) return;
      if (event.key === "Escape") {
        setReason(null);
        setPersonMenuOpen(false);
        return;
      }
      const command = globalCommandFor(event);
      if (!command) return;
      // A payment, a void or another sheet is open: every global key waits,
      // Ctrl+L too, so nothing typed into it is lost.
      if (otherDialogOpen()) return;
      event.preventDefault();
      setPersonMenuOpen(false);
      if (command.kind === "lock") {
        onLock();
        return;
      }
      if (command.kind === "command-search") {
        setSearchOpen(true);
        return;
      }
      setSearchOpen(false);
      go(command.page);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, onLock]);

  const commands = useMemo<ShellCommand[]>(() => {
    const sections = rail.map((item: RailItem) => {
      const Icon = RAIL_ICON[item.page];
      return {
        id: `section-${item.page}`,
        label: item.label,
        description: SECTION_SEARCH[item.page].description,
        keywords: SECTION_SEARCH[item.page].keywords,
        icon: <Icon />,
        keys: keyHintFor(item.page),
        disabledReason: item.disabledReason,
        run: () => go(item.page),
      };
    });
    return [
      ...sections,
      {
        id: "lock",
        label: "Lock the till",
        description: "Lock now; the next person signs in with their PIN",
        keywords: ["lock", "away", "break"],
        icon: <Lock />,
        keys: keyHintForCommand("lock"),
        run: onLock,
      },
      {
        id: "switch-person",
        label: "Switch person",
        description: "Hand the till to someone else",
        keywords: ["sign out", "log out", "change person", "another waiter"],
        icon: <UsersRound />,
        run: onSwitchPerson,
      },
      {
        id: "theme-light",
        label: "Light theme",
        description: theme === "light" ? "In use. For bright rooms" : "For bright rooms",
        keywords: ["light", "theme", "display", "day", "bright"],
        icon: <Sun />,
        run: () => chooseTheme("light"),
      },
      {
        id: "theme-dark",
        label: "Dark theme",
        description: theme === "dark" ? "In use. For dim bars and kitchens" : "For dim bars and kitchens",
        keywords: ["dark", "theme", "display", "night"],
        icon: <Moon />,
        run: () => chooseTheme("dark"),
      },
    ];
  }, [rail, go, onLock, onSwitchPerson, theme]);

  const displayName = normalizeMode(mode) === "BAR_DISPLAY" ? "Bar display" : "Kitchen display";

  return (
    <div className={cn("terminal-shell", display && "terminal-shell--kds")} data-testid="pos-register">
      <header className="y-topbar">
        <PlaceMark place={place} className="y-topbar__till" data-testid="till-label" />
        {display ? (
          <StatusChip tone="info" className="y-topbar__status" data-testid="kds-mode-badge">
            {displayName}
          </StatusChip>
        ) : offlineCash ? (
          <StatusChip
            tone="warning"
            className="y-topbar__status"
            icon={<WifiOff aria-hidden="true" />}
            data-testid="shell-offline-cash"
          >
            Cash only
          </StatusChip>
        ) : (
          <StatusChip
            tone="neutral"
            className="y-topbar__status y-shift"
            icon={<Clock aria-hidden="true" />}
            data-testid="shell-business-date"
            role="status"
            aria-label={shift?.full || "No shift open"}
          >
            <span className="y-shift__full">{shift?.full || "No shift open"}</span>
            <span className="y-shift__short">{shift?.short || shift?.full || "No shift open"}</span>
          </StatusChip>
        )}
        <span className="y-topbar__spacer" />
        <button
          type="button"
          className="y-button y-button--quiet y-button--48 y-topbar__search"
          aria-label="Search the till"
          onClick={() => setSearchOpen(true)}
        >
          <Search aria-hidden="true" />
          <span className="y-topbar__search-label">Search</span>
          <KeyHint keys={keyHintForCommand("command-search") ?? ""} />
        </button>
        {connection}
        <span className="y-topbar__clock" data-testid="shell-clock">
          {clock}
        </span>
        <ThemeToggle />
        {display ? (
          <Button variant="secondary" icon={<LogOut />} data-testid="kds-log-out" onClick={onSwitchPerson}>
            Log out
          </Button>
        ) : null}
        <PersonMenu
          person={person}
          open={personMenuOpen}
          onOpenChange={setPersonMenuOpen}
          onSwitchPerson={onSwitchPerson}
          onLock={onLock}
        />
      </header>

      <div className="y-banners">{banners}</div>

      {display ? null : (
        <nav className="y-rail" data-testid="terminal-navigation" aria-label="Till sections">
          {rail.map((item) => {
            const Icon = RAIL_ICON[item.page];
            const keys = keyHintFor(item.page);
            return (
              <button
                key={item.page}
                type="button"
                data-testid={`nav-${item.page}`}
                className="y-rail__item"
                aria-current={page === item.page ? "page" : undefined}
                aria-disabled={item.disabledReason ? true : undefined}
                aria-describedby={item.disabledReason ? `rail-reason-${item.page}` : undefined}
                onClick={() => go(item.page)}
              >
                <Icon className="y-rail__icon" aria-hidden="true" />
                {item.disabledReason ? <Ban className="y-rail__closed" aria-hidden="true" /> : null}
                <span className="y-rail__label">{item.label}</span>
                {item.page === "status" && updateReady ? (
                  <>
                    <span className="y-rail__badge" aria-hidden="true" data-testid="nav-status-update" />
                    <span className="sr-only">Update ready</span>
                  </>
                ) : null}
                {keys ? <KeyHint keys={keys} className="y-rail__key" /> : null}
                {item.disabledReason ? (
                  <span id={`rail-reason-${item.page}`} className="sr-only">
                    {item.disabledReason}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      )}

      {reason ? (
        <p className="y-rail-reason" role="status" data-testid="rail-reason" style={{ top: reason.top }}>
          <Info aria-hidden="true" />
          {reason.text}
        </p>
      ) : null}

      <main
        className={cn("terminal-workspace", workspaceVariant === "full" && "terminal-workspace--order")}
        data-testid="terminal-workspace"
      >
        {children}
      </main>

      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} commands={commands} />
    </div>
  );
}
