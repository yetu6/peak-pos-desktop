/**
 * Dev-only menu catalog for the POS compose screen.
 *
 * Peak exposes NO read route for menu items yet (only `POST
 * /pos-config/menu-items` for configuration), so the operator's register
 * cannot fetch the outlet menu. Until `GET /pos-config/menu-items` exists
 * (see KNOWN GAPS), the client boots from this catalog. The server is still
 * the source of truth for names, prices, and tax — the client only supplies
 * the `menuItemId`, exactly like the dev header identity.
 *
 * Item ids must reference menu items actually seeded in the tenant property.
 * Override with real ids via the `VITE_PEAK_MENU_ITEMS` env var
 * (JSON array of { id, name, category }) — the journey test relies on it.
 */

export interface DevMenuItem {
  id: string;
  name: string;
  category: string;
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
    if (Array.isArray(parsed) && parsed.every((i) => i?.id && i?.name)) {
      return parsed;
    }
  } catch {
    // Fall through to the builtin catalog; a misconfigured override must not
    // brick the register.
  }
  return BUILTIN;
}