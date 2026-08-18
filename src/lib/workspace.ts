export type WorkspacePage = "orders" | "new" | "kitchen";

export interface WorkspaceItem {
  page: WorkspacePage;
  label: string;
  icon: "orders" | "kitchen" | "plus";
}

const ALL: WorkspaceItem[] = [
  { page: "orders", label: "Active Orders", icon: "orders" },
  { page: "new", label: "New Order", icon: "plus" },
  { page: "kitchen", label: "Kitchen", icon: "kitchen" },
];

/**
 * Mode is a workspace layout, not a security boundary. Peak still checks
 * every command. The till never picks its own mode — the manager did at pairing.
 */
export function workspaceNav(mode?: string | null): WorkspaceItem[] {
  const normalized = (mode ?? "POS").trim().toUpperCase().replace(/-/g, "_");
  if (normalized === "KITCHEN_DISPLAY" || normalized === "BAR_DISPLAY") {
    return ALL.filter((item) => item.page === "kitchen");
  }
  if (normalized === "CASHIER") {
    return ALL.filter((item) => item.page !== "kitchen");
  }
  return ALL;
}

export function defaultWorkspacePage(mode?: string | null): WorkspacePage {
  return workspaceNav(mode)[0]?.page ?? "orders";
}
