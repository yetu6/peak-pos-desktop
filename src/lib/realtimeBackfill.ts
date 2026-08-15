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
/** Peak's replay default; ask for it explicitly so paging is deterministic. */
const REPLAY_PAGE_SIZE = 200;
const MAX_REPLAY_PAGES = 50;

interface ReplayPage {
  events: RealtimeEnvelope[];
  nextCursor: number | null;
}

/**
 * REST backfill for the dev runtime: replays the committed journal through the
 * same canonical envelope the live stream delivers, so a client that connects
 * late (or reconnects after a gap) sees every event exactly once.
 *
 * Auth stays on the header-identity POS loop. A PIN session authenticates the
 * socket via `PEAK_OPS_TOKEN` on the Node bridge; mixing that bearer with
 * identity headers is refused by Peak, so this fetch never sends `Authorization`.
 */
export function createRealtimeBackfill(baseUrl: string = API_BASE_URL): RealtimeBackfill {
  const identity = devIdentityFromEnv();
  return {
    fetchEvents: async (after: number): Promise<RealtimeEnvelope[]> => {
      const collected: RealtimeEnvelope[] = [];
      let cursor = after;
      for (let page = 0; page < MAX_REPLAY_PAGES; page++) {
        const replay = await fetchReplayPage(baseUrl, identity.propertyId, cursor, {
          tenantId: identity.tenantId,
          userId: identity.userId,
        });
        if (replay.events.length === 0) {
          return collected;
        }
        collected.push(...replay.events);
        if (replay.nextCursor == null || replay.nextCursor === cursor) {
          return collected;
        }
        cursor = replay.nextCursor;
      }
      return collected;
    },
  };
}

async function fetchReplayPage(
  baseUrl: string,
  propertyId: string,
  after: number,
  identity: { tenantId: string; userId: string },
): Promise<ReplayPage> {
  const url =
    `${baseUrl}/api/v1/properties/${propertyId}/realtime/events` +
    `?after=${after}&limit=${REPLAY_PAGE_SIZE}`;
  const response = await fetch(url, {
    headers: {
      "X-Peak-Tenant-Id": identity.tenantId,
      "X-Peak-Tenant-User-Id": identity.userId,
    },
  });
  if (!response.ok) {
    throw new Error(`Realtime backfill failed with HTTP ${response.status}`);
  }
  return (await response.json()) as ReplayPage;
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
