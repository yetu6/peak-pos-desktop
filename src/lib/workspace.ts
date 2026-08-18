export type WorkspacePage = "orders" | "new" | "kitchen" | "status";

export interface WorkspaceItem {
  page: WorkspacePage;
  label: string;
  icon: "orders" | "kitchen" | "plus" | "info";
}

const ALL: WorkspaceItem[] = [
  { page: "orders", label: "Active Orders", icon: "orders" },
  { page: "new", label: "New Order", icon: "plus" },
  { page: "kitchen", label: "Kitchen", icon: "kitchen" },
];

const STATUS: WorkspaceItem = { page: "status", label: "Status", icon: "info" };

/**
 * Mode is a workspace layout, not a security boundary. Peak still checks
 * every command. The till never picks its own mode — the manager did at pairing.
 */
export function workspaceNav(mode?: string | null): WorkspaceItem[] {
  const normalized = (mode ?? "POS").trim().toUpperCase().replace(/-/g, "_");
  let items: WorkspaceItem[];
  if (normalized === "KITCHEN_DISPLAY" || normalized === "BAR_DISPLAY") {
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
