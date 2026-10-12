import type { RealtimeEnvelope } from "../realtime/RealtimeEnvelope";
import { devIdentityFromEnv, type DevIdentity } from "./env";
import { getOperationalSession } from "./operationalSession";
import { registerPropertyId } from "./restAuth";

export interface RealtimeCursorStorage {
  get: () => number | null;
  set: (cursor: number) => void;
}

const CURSOR_KEY = "peak-pos-realtime-cursor";

function tryDevIdentity(): DevIdentity | null {
  try {
    return devIdentityFromEnv();
  } catch {
    return null;
  }
}

let catchUpNoted = false;

/**
 * POS realtime catch-up, off on purpose. fbc-peak offers no catch-up route
 * for POS events: its contract (connectPOSWebSocket) says REST stays
 * authoritative and a till reconnects by fetching its order and shift
 * snapshots, which the till does on every (re)connect (RealtimeProvider's
 * resync refetches everything). The route this used to call,
 * /api/v1/properties/{id}/realtime/events, does not exist (404). Noted once
 * in the log for whoever reads it; nothing shows on screen. A replay route
 * is a backend follow-up.
 */
export async function noPosCatchUp(_after: number): Promise<RealtimeEnvelope[]> {
  if (!catchUpNoted) {
    catchUpNoted = true;
    console.info(
      "Yetu till: no POS realtime catch-up route on the backend; snapshots are fetched again on each (re)connect instead.",
    );
  }
  return [];
}

export function createRealtimeCursorStorage(
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): RealtimeCursorStorage {
  const session = getOperationalSession();
  const env = tryDevIdentity();
  const propertyId = registerPropertyId(session, env) ?? "unknown";
  const key = `${CURSOR_KEY}-${propertyId}`;
  return {
    get: () => {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    },
    set: (cursor: number) => storage.setItem(key, String(cursor)),
  };
}
