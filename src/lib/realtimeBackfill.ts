import type { RealtimeEnvelope } from "../realtime/RealtimeEnvelope";
import { devIdentityFromEnv, type DevIdentity } from "./env";
import { getApiBaseUrl } from "./peakConfig";
import {
  getOperationalSession,
  SessionExpiredError,
} from "./operationalSession";
import { registerPropertyId, socketAlignedHeaders } from "./restAuth";

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

function tryDevIdentity(): DevIdentity | null {
  try {
    return devIdentityFromEnv();
  } catch {
    return null;
  }
}

/**
 * REST backfill for committed journal events. Auth matches the STOMP socket:
 * `PEAK_OPS_TOKEN` bearer XOR X-Peak identity headers — never both. Peak
 * refuses a mixed handshake, and mixing here would desync replay from live.
 */
export function createRealtimeBackfill(baseUrl: string = getApiBaseUrl()): RealtimeBackfill {
  return {
    fetchEvents: async (after: number): Promise<RealtimeEnvelope[]> => {
      const session = getOperationalSession();
      const env = tryDevIdentity();
      const propertyId = registerPropertyId(session, env);
      if (!propertyId) {
        throw new Error("A property id is required to backfill realtime events");
      }
      const headers = socketAlignedHeaders(session, env);
      const collected: RealtimeEnvelope[] = [];
      let cursor = after;
      for (let page = 0; page < MAX_REPLAY_PAGES; page++) {
        const replay = await fetchReplayPage(baseUrl, propertyId, cursor, headers);
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
  headers: Record<string, string>,
): Promise<ReplayPage> {
  const url =
    `${baseUrl}/api/v1/properties/${propertyId}/realtime/events` +
    `?after=${after}&limit=${REPLAY_PAGE_SIZE}`;
  const response = await fetch(url, { headers });
  if (response.status === 401) {
    throw new SessionExpiredError();
  }
  if (!response.ok) {
    throw new Error(`Realtime backfill failed with HTTP ${response.status}`);
  }
  return (await response.json()) as ReplayPage;
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
