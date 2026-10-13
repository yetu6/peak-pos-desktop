export type WorkspacePage = "orders" | "new" | "kitchen" | "manager" | "status";

export interface WorkspaceItem {
  page: WorkspacePage;
  label: string;
}

const ALL: WorkspaceItem[] = [
  { page: "orders", label: "Orders" },
  { page: "new", label: "Sell" },
  { page: "kitchen", label: "Kitchen" },
  { page: "manager", label: "Cash" },
];

const STATUS: WorkspaceItem = { page: "status", label: "Status" };

function normalizeMode(mode?: string | null): string {
  return (mode ?? "POS").trim().toUpperCase().replace(/-/g, "_");
}

/**
 * Mode is a workspace layout, not a security boundary. Peak still checks
 * every command. The till never picks its own mode — the manager did at pairing.
 * `offline-cash` is a temporary operational mode from PIN unlock when Peak is
 * unreachable (not a pairing workspace).
 */
export function workspaceNav(mode?: string | null): WorkspaceItem[] {
  const normalized = normalizeMode(mode);
  let items: WorkspaceItem[];
  if (normalized === "OFFLINE_CASH") {
    items = ALL.filter((item) => item.page === "new");
  } else if (normalized === "KITCHEN_DISPLAY" || normalized === "BAR_DISPLAY") {
    items = ALL.filter((item) => item.page === "kitchen");
  } else if (normalized === "CASHIER") {
    items = ALL.filter((item) => item.page !== "kitchen");
  } else {
    items = ALL;
  }
  return [...items, STATUS];
}

export function defaultWorkspacePage(mode?: string | null): WorkspacePage {
  return workspaceNav(mode)[0]?.page ?? "orders";
}

/** Kitchen and bar displays show their tickets full screen, with no rail. */
export function isDisplayMode(mode?: string | null): boolean {
  const normalized = normalizeMode(mode);
  return normalized === "KITCHEN_DISPLAY" || normalized === "BAR_DISPLAY";
}

export interface RailItem extends WorkspaceItem {
  /** Present when the section is shown but closed right now, in words. */
  disabledReason?: string;
}

/** Rail order: the job people do most comes first and never moves. */
const RAIL_ORDER: WorkspacePage[] = ["new", "orders", "kitchen", "manager", "status"];

/** Named setting: what a closed section says while the till works offline. */
export const OFFLINE_SECTION_REASON = "needs a connection. It opens again when the till is back online.";

/**
 * The rail for a till paired in `mode`. Sections the mode does not include are
 * left out (a cashier till has no Kitchen). While working offline the rail
 * keeps every position, so nothing moves under a finger, and a section that
 * needs the connection is shown closed with the reason in words.
 */
export function railNav(mode?: string | null, options: { offlineCash?: boolean } = {}): RailItem[] {
  const paired = workspaceNav(mode);
  const open = new Set(workspaceNav(options.offlineCash ? "offline-cash" : mode).map((item) => item.page));
  return [...paired]
    .sort((a, b) => RAIL_ORDER.indexOf(a.page) - RAIL_ORDER.indexOf(b.page))
    .map((item) =>
      open.has(item.page) ? { ...item } : { ...item, disabledReason: `${item.label} ${OFFLINE_SECTION_REASON}` },
    );
}
