import type { RealtimeEnvelope } from "../realtime/RealtimeEnvelope";
import { API_BASE_URL, devIdentityFromEnv } from "./env";

export interface RealtimeBackfill {
  /** Fetches committed events strictly after `after` (ascending). */
  fetchEvents: (after: number) => Promise<RealtimeEnvelope[]>;
}

export interface RealtimeCursorStorage {
  get: () => number | null;
  set: (cursor: number) => void;
}

const CURSOR_KEY = "peak-pos-realtime-cursor";

/**
 * REST backfill for the dev runtime: replays the committed journal through the
 * same canonical envelope the live stream delivers, so a client that connects
 * late (or reconnects after a gap) sees every event exactly once.
 */
export function createRealtimeBackfill(baseUrl: string = API_BASE_URL): RealtimeBackfill {
  const identity = devIdentityFromEnv();
  return {
    fetchEvents: async (after: number): Promise<RealtimeEnvelope[]> => {
      const url = `${baseUrl}/api/v1/properties/${identity.propertyId}/realtime/events?after=${after}`;
      const response = await fetch(url, {
        headers: {
          "X-Peak-Tenant-Id": identity.tenantId,
          "X-Peak-Tenant-User-Id": identity.userId,
        },
      });
      if (!response.ok) {
        throw new Error(`Realtime backfill failed with HTTP ${response.status}`);
      }
      const body = (await response.json()) as {
        events: RealtimeEnvelope[];
        nextCursor: number | null;
      };
      return body.events;
    },
  };
}

export function createRealtimeCursorStorage(
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): RealtimeCursorStorage {
  const identity = devIdentityFromEnv();
  const key = `${CURSOR_KEY}-${identity.propertyId}`;
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