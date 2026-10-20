import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDeviceNetworkFailure } from "./deviceAuth";
import { requestTimesWords, resetRequestTimes } from "./requestTimes";
import { yetuFetch } from "./yetuFetch";

// The till's native side as src-tauri/src/yetu_http.rs answers: the status,
// the headers as pairs, the body as text; a request it could not send at all
// is refused with reqwest's words.
const native = vi.hoisted(() => ({
  calls: [] as { command: string; args: Record<string, unknown> }[],
  answer: null as unknown,
  refuse: null as string | null,
  hold: false,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: Record<string, unknown>) => {
    native.calls.push({ command, args });
    if (native.hold) return new Promise(() => {});
    if (native.refuse) throw native.refuse;
    return native.answer;
  }),
}));

const ORDERS = "https://api.example.test/api/v1/pos/orders";

function inTheTill() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

beforeEach(() => {
  native.calls = [];
  native.answer = null;
  native.refuse = null;
  native.hold = false;
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
  resetRequestTimes();
});

describe("yetuFetch in the till", () => {
  it("sends the request from the native side and hands back its answer as a Response", async () => {
    inTheTill();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    native.answer = {
      status: 201,
      headers: [["content-type", "application/json"], ["x-request-id", "r-1"]],
      body: '{"id":"o-8"}',
    };

    const response = await yetuFetch(ORDERS, {
      method: "post",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "k-1" },
      body: '{"orderType":"TAKEAWAY"}',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(native.calls).toEqual([
      {
        command: "yetu_request",
        args: {
          request: {
            method: "POST",
            url: ORDERS,
            headers: [["content-type", "application/json"], ["idempotency-key", "k-1"]],
            body: '{"orderType":"TAKEAWAY"}',
          },
        },
      },
    ]);
    expect(response.status).toBe(201);
    expect(response.ok).toBe(true);
    expect(response.headers.get("X-Request-ID")).toBe("r-1");
    expect(await response.json()).toEqual({ id: "o-8" });
  });

  it("takes an answer with no body, like the check-in's 204", async () => {
    inTheTill();
    native.answer = { status: 204, headers: [], body: "" };
    const response = await yetuFetch(`${ORDERS}/o-8/heartbeat`, { method: "POST", body: "{}" });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("says a request that never reached Yetu the way a browser does, so it reads as can't reach Yetu", async () => {
    inTheTill();
    native.refuse = "error sending request for url (https://api.example.test/api/v1/pos/orders)";
    const failure = await yetuFetch(ORDERS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TypeError);
    expect(String(failure)).toMatch(/Failed to fetch: error sending request/);
    expect(isDeviceNetworkFailure(failure)).toBe(true);
  });

  it("stops waiting when the caller gives up, as the Yetu check does after 4 s", async () => {
    inTheTill();
    native.hold = true;
    const controller = new AbortController();
    const waiting = yetuFetch(`${ORDERS}/../../health/ready`, { signal: controller.signal });
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
    await expect(waiting).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("notes how long each answer took, a change apart from a look-up", async () => {
    inTheTill();
    native.answer = { status: 200, headers: [], body: "{}" };
    await yetuFetch(ORDERS, { method: "POST", body: "{}" });
    await yetuFetch(ORDERS);
    expect(requestTimesWords()).toMatch(/^Changes \d\.\d\d s · Look-ups \d\.\d\d s \(usual of the last 2\)$/);
  });
});

describe("yetuFetch outside the till", () => {
  it("is the browser's fetch, and still notes the time", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const init = { method: "GET", headers: { Authorization: "Bearer t" } };
    await yetuFetch(ORDERS, init);
    expect(fetchSpy).toHaveBeenCalledWith(ORDERS, init);
    expect(native.calls).toEqual([]);
    expect(requestTimesWords()).toMatch(/^Look-ups \d\.\d\d s \(usual of the last 1\)$/);
  });
});

// A request sent with fetch directly would go from the web view again: a
// preflight per new address and, on Linux, a new connection per change.
describe("every request to Yetu", () => {
  it("goes through yetuFetch", () => {
    // The ops-token bridge is a helper on this computer, not Yetu.
    const notYetu = new Set(["src/lib/applyOpsToken.ts", "src/lib/yetuFetch.ts"]);
    const files = (readdirSync("src", { recursive: true }) as string[])
      .map((file) => join("src", file))
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !notYetu.has(file));
    // Called, or handed on as the one to use (a default like `fetchImpl = fetch`).
    const direct = files.filter((file) => /(^|[^\w.$])fetch\s*\(|=\s*fetch(?![\w$])/m.test(readFileSync(file, "utf8")));
    expect(direct).toEqual([]);
  });
});

// The native side lets through only the headers it names
// (src-tauri/src/yetu_http.rs ALLOWED_HEADERS). A header set here that it
// doesn't name would fail only inside the till.
describe("every header the till sets", () => {
  it("is one the native side lets through", () => {
    // Not Yetu requests: the ops-token bridge, and the live-updates socket,
    // which opens from the native side with its own Origin (socket.rs).
    const notYetu = new Set(["src/lib/applyOpsToken.ts", "src/lib/peakSocket.ts", "src/lib/nativePeakSocket.ts"]);
    const rust = readFileSync("src-tauri/src/yetu_http.rs", "utf8");
    const list = /const ALLOWED_HEADERS: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust)?.[1] ?? "";
    const allowed = new Set([...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
    expect(allowed.has("authorization")).toBe(true);
    const files = (readdirSync("src", { recursive: true }) as string[])
      .map((file) => join("src", file))
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !notYetu.has(file));
    const set = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // Header names as the till writes them: "Content-Type": or Authorization:, inside a headers object.
      for (const block of source.matchAll(/headers\s*[:=(]\s*\{([^}]*)\}/g)) {
        for (const name of block[1].matchAll(/(?:^|[,{\s])"?([A-Za-z][A-Za-z-]*)"?\s*:/g)) set.add(name[1].toLowerCase());
      }
      for (const name of source.matchAll(/"((?:X|If)-[A-Za-z-]+|Idempotency-Key|Content-Type|Authorization)"/g)) set.add(name[1].toLowerCase());
    }
    expect(set.has("idempotency-key")).toBe(true);
    expect([...set].filter((name) => !allowed.has(name)).sort()).toEqual([]);
  });
});
