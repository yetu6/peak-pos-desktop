import { getOperationalSession } from "./operationalSession";

/**
 * A test business (owner, 2026-10-28): the catalogue says so, and the till
 * shows a banner and marks every paper. The answer is kept on this till with
 * the business it came from, so papers printed offline are still marked and
 * the lock screen can show the banner before anyone signs in. It stays true
 * until a fresh catalogue says otherwise. A catalogue that does not say (an
 * older Yetu) changes nothing. Advisory only: it grants no authority.
 */
const KEY = "yetu-test-business";

interface Kept { property: string; outlet: string; test: boolean }

function kept(): Kept | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Kept> | null;
    return value && typeof value.property === "string" && typeof value.outlet === "string" && typeof value.test === "boolean" ? (value as Kept) : null;
  } catch {
    return null;
  }
}

export function cacheTestBusiness(property: string | null, outlet: string | null, says: boolean | undefined): void {
  if (!property || !outlet || typeof says !== "boolean") return;
  try { localStorage.setItem(KEY, JSON.stringify({ property, outlet, test: says })); } catch { /* storage full: online answers still apply */ }
}

/**
 * What this till last heard. With a business named, only an answer for that
 * business counts; with none (the lock screen), the last answer on this till.
 */
export function cachedTestBusiness(property?: string | null, outlet?: string | null): boolean {
  const value = kept();
  if (!value || !value.test) return false;
  if (property && outlet) return value.property === property && value.outlet === outlet;
  return true;
}

/** Whether the signed-in till's business is a test business, as last heard. */
export function testBusinessNow(): boolean {
  const session = getOperationalSession();
  return cachedTestBusiness(session?.propertyId, session?.outletId);
}
