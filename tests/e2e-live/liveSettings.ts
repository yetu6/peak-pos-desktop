/** Where the live API from tests/e2e-live/live-api.sh answers (the journey reads the same variable). */
export const LIVE_API_URL = (process.env.PEAK_JOURNEY_BASE_URL ?? "http://127.0.0.1:18080").replace(/\/+$/, "");

/** The till's dev server for this suite: a port of its own, never a dev server running older code. */
export const TILL_PORT = 5199;

/** The dev realtime bridge's port: the till's default VITE_PEAK_REALTIME_BRIDGE_URL (ws://localhost:5174/bridge). */
export const BRIDGE_PORT = 5174;

/** The seeded restaurant (cmd/e2e-seed's Mama Rose), as split out by live-api.sh seed. */
export const FIXTURE_PATH = process.env.PEAK_JOURNEY_MAMA_ROSE ?? "";
