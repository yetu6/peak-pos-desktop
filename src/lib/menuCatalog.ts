/**
 * Outlet menu for the New Order board.
 *
 * Prefers Peak `GET /api/v1/properties/{propertyId}/pos-config/menu-items?outletId=`
 * (permission `pos.view`) and joins category names from
 * `GET .../menu-categories?outletId=`. Falls back to the documented dev catalog
 * only on HTTP 404. Other failures surface to the till. Prices stay server-side.
 *
 * Override fallback ids via `VITE_PEAK_MENU_ITEMS` (JSON array of
 * { id, name, category }) — the journey test relies on it.
 */

export interface DevMenuItem {
  id: string;
  name: string;
  category: string;
}

export type MenuSource = "peak" | "dev-catalog";

export interface OutletMenu {
  items: DevMenuItem[];
  source: MenuSource;
}

const BUILTIN: DevMenuItem[] = [
  { id: "00000000-0000-0000-0000-000000000001", name: "Nyama Choma", category: "Grill" },
  { id: "00000000-0000-0000-0000-000000000002", name: "Chips & Chicken", category: "Kitchen" },
  { id: "00000000-0000-0000-0000-000000000003", name: "Uji wa Wimbi", category: "Breakfast" },
  { id: "00000000-0000-0000-0000-000000000004", name: "Chapati & Maharage", category: "Kitchen" },
  { id: "00000000-0000-0000-0000-000000000005", name: "Konyagi Tonic", category: "Bar" },
  { id: "00000000-0000-0000-0000-000000000006", name: "Tusker Lager", category: "Bar" },
];

export function devMenuItems(): DevMenuItem[] {
  const raw = import.meta.env.VITE_PEAK_MENU_ITEMS as string | undefined;
  if (!raw) return BUILTIN;
  try {
    const parsed = JSON.parse(raw) as DevMenuItem[];
    if (Array.isArray(parsed) && parsed.every((item) => item?.id && item?.name)) {
      return parsed;
    }
  } catch {
    // A misconfigured override must not brick the register.
  }
  return BUILTIN;
}

function asRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && "items" in body) {
    const items = (body as { items: unknown }).items;
    return Array.isArray(items) ? items : [];
  }
  if (body && typeof body === "object" && "menuItems" in body) {
    const items = (body as { menuItems: unknown }).menuItems;
    return Array.isArray(items) ? items : [];
  }
  if (body && typeof body === "object" && "products" in body) {
    const products = (body as { products: unknown }).products;
    return Array.isArray(products) ? products : [];
  }
  return [];
}

export function parseMenuItems(body: unknown): DevMenuItem[] {
  return asRows(body).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = record.id ?? record.menuItemId;
    const name = record.name;
    if (id == null || typeof name !== "string" || name.length === 0) return [];
    const category =
      (typeof record.category === "string" && record.category) ||
      (typeof record.categoryName === "string" && record.categoryName) ||
      "Menu";
    return [{ id: String(id), name, category }];
  });
}

export async function fetchOutletMenu(args: {
  baseUrl: string;
  propertyId: string;
  outletId: string;
  headers: Record<string, string>;
}): Promise<OutletMenu> {
  const response = await fetch(`${args.baseUrl}/api/v1/pos/catalog`, { headers: args.headers });
  if (!response.ok) {
    throw new Error(`Menu GET failed with HTTP ${response.status}`);
  }
  const raw = await response.json();
  const items = asRows(raw).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = record.id ?? record.menuItemId;
    const name = record.name;
    if (id == null || typeof name !== "string" || name.length === 0) return [];
    const category =
      (typeof record.category === "string" && record.category) ||
      (typeof record.categoryName === "string" && record.categoryName) ||
      "Menu";
    return [{ id: String(id), name, category }];
  });
  return { items, source: "peak" };
}
