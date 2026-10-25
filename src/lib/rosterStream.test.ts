import { describe, expect, it, vi } from "vitest";
import {
  ROSTER_LIVE_RETRY_FIRST_SECONDS,
  ROSTER_LIVE_RETRY_MAX_SECONDS,
  ROSTER_LIVE_STEADY_SECONDS,
} from "../access/accessSettings";
import { createSseReader, followRosterStream, ROSTER_STREAM_RETRY, rosterStreamDelay, type SseEvent } from "./rosterStream";

const BASE = "https://api.yetu.test";

/** A stream Yetu keeps open, written to by the test as Yetu would. */
function openStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel: cancelled,
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    cancelled,
  };
}

function problem(status: number, code: string, detail?: string): Response {
  return new Response(JSON.stringify({ status, code, detail }), { status, headers: { "Content-Type": "application/problem+json" } });
}

/** Records each wait instead of waiting; the test ends the stream after `stopAfter` waits. */
function recordedWaits(controller: AbortController, stopAfter: number) {
  const waits: number[] = [];
  const wait = async (ms: number) => {
    waits.push(ms);
    if (waits.length >= stopAfter) controller.abort();
  };
  return { waits, wait };
}

describe("reading the event stream", () => {
  function eventsOf(pieces: string[]): SseEvent[] {
    const events: SseEvent[] = [];
    const reader = createSseReader((event) => events.push(event));
    for (const piece of pieces) reader.push(piece);
    return events;
  }

  it("puts an event together when its lines arrive split across pieces", () => {
    expect(eventsOf(["event: ros", "ter\ndata: {", "}\n", "\n"])).toEqual([{ event: "roster", data: "{}" }]);
  });

  it("takes \\r\\n split between two pieces as one line end", () => {
    expect(eventsOf(["event: roster\r", "\ndata: {}\r\n\r", "\n"])).toEqual([{ event: "roster", data: "{}" }]);
  });

  it("skips comments, Yetu's keep-alive among them", () => {
    expect(eventsOf([": connected\n\n", ": keep-alive\n\n", "event: roster\ndata: {}\n\n", ": keep-alive\n\n"])).toEqual([
      { event: "roster", data: "{}" },
    ]);
  });

  it("follows the event stream rules: data lines join, an event without data is dropped, the name defaults", () => {
    expect(eventsOf(["data: a\ndata: b\n\n", "event: roster\n\n", "data:c\n\n"])).toEqual([
      { event: "message", data: "a\nb" },
      { event: "message", data: "c" },
    ]);
  });
});

describe("the roster stream", () => {
  it("opens with the till's credential in the body and reads the list again on each roster event", async () => {
    const stream = openStream();
    const send = vi.fn(async () => stream.response);
    const onRoster = vi.fn();
    const controller = new AbortController();
    const following = followRosterStream({
      baseUrl: `${BASE}/`,
      terminalId: "terminal-1",
      deviceCredential: "device-secret",
      onRoster,
      signal: controller.signal,
      fetch: send,
    });

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/pos/device/roster/events`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ terminalId: "terminal-1", deviceCredential: "device-secret" });
    expect(init.signal).toBe(controller.signal);

    stream.send(": connected\n\n");
    stream.send("event: roster\ndata: {}\n\n");
    await vi.waitFor(() => expect(onRoster).toHaveBeenCalledTimes(1));
    stream.send(": keep-alive\n\nevent: something-else\ndata: {}\n\nevent: ros");
    stream.send("ter\ndata: {}\n");
    expect(onRoster).toHaveBeenCalledTimes(1);
    stream.send("\n");
    await vi.waitFor(() => expect(onRoster).toHaveBeenCalledTimes(2));

    controller.abort();
    await following;
    expect(stream.cancelled).toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("tries again after 1, 2, 4 … seconds, never more than 30", async () => {
    const controller = new AbortController();
    const { waits, wait } = recordedWaits(controller, 7);
    const send = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await followRosterStream({ baseUrl: BASE, terminalId: "t", deviceCredential: "c", onRoster: vi.fn(), signal: controller.signal, fetch: send, wait, now: () => 0 });
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(send).toHaveBeenCalledTimes(7);
  });

  it("starts from one second again after a line that stayed up, but not after one that dropped at once", async () => {
    const controller = new AbortController();
    const { waits, wait } = recordedWaits(controller, 5);
    let clock = 0;
    const answers: Array<() => Response> = [
      () => { throw new TypeError("Failed to fetch"); },
      // Opened, and closed straight away.
      () => new Response("", { status: 200 }),
      // Up for as long as a steady line, then dropped.
      () => { clock += ROSTER_STREAM_RETRY.steadyMs; return new Response("", { status: 200 }); },
      () => { throw new TypeError("Failed to fetch"); },
      () => { throw new TypeError("Failed to fetch"); },
    ];
    const send = vi.fn(async () => answers[send.mock.calls.length - 1]());
    await followRosterStream({ baseUrl: BASE, terminalId: "t", deviceCredential: "c", onRoster: vi.fn(), signal: controller.signal, fetch: send, wait, now: () => clock });
    expect(waits).toEqual([1_000, 2_000, 1_000, 2_000, 4_000]);
  });

  it("waits the longest when Yetu does not know the till or live updates are off, and as long as Yetu asks after too many", async () => {
    const controller = new AbortController();
    const { waits, wait } = recordedWaits(controller, 6);
    const answers = [
      problem(401, "POS_DEVICE_UNAUTHORIZED"),
      problem(503, "REALTIME_UNAVAILABLE"),
      problem(403, "FORBIDDEN"),
      // A server error is any other failure: the usual doubling.
      problem(500, "INTERNAL_ERROR"),
      problem(429, "RATE_LIMITED", "Too many requests. Try again in 90 seconds."),
      problem(429, "RATE_LIMITED", "Too many requests. Try again in 5 seconds."),
    ];
    const send = vi.fn(async () => answers[send.mock.calls.length - 1]);
    await followRosterStream({ baseUrl: BASE, terminalId: "t", deviceCredential: "c", onRoster: vi.fn(), signal: controller.signal, fetch: send, wait, now: () => 0 });
    expect(waits).toEqual([30_000, 30_000, 30_000, 8_000, 90_000, 30_000]);
  });

  it("reads the list again after a reconnect, not on the first connection", async () => {
    const first = openStream();
    const second = openStream();
    const streams = [first, second];
    const send = vi.fn(async () => streams[send.mock.calls.length - 1].response);
    const onRoster = vi.fn();
    const controller = new AbortController();
    const following = followRosterStream({ baseUrl: BASE, terminalId: "t", deviceCredential: "c", onRoster, signal: controller.signal, fetch: send, wait: async () => undefined });

    first.send(": connected\n\n");
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(onRoster).not.toHaveBeenCalled();
    first.close();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(onRoster).toHaveBeenCalledTimes(1));

    controller.abort();
    await following;
  });

  it("stops at once when the till leaves its sign-in screen, during a wait as well", async () => {
    const controller = new AbortController();
    const send = vi.fn(async () => problem(503, "REALTIME_UNAVAILABLE"));
    // The real wait: 30 seconds after a 503, cut short by the abort.
    const following = followRosterStream({ baseUrl: BASE, terminalId: "t", deviceCredential: "c", onRoster: vi.fn(), signal: controller.signal, fetch: send });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    // The answer is read and the 30-second wait has begun.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = Date.now();
    controller.abort();
    await following;
    expect(Date.now() - before).toBeLessThan(1_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not open at all once aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const send = vi.fn();
    await followRosterStream({ baseUrl: BASE, terminalId: "t", deviceCredential: "c", onRoster: vi.fn(), signal: controller.signal, fetch: send });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("its named settings", () => {
  it("are 1 second first, 30 at most, and 60 to count as steady", () => {
    expect([ROSTER_LIVE_RETRY_FIRST_SECONDS, ROSTER_LIVE_RETRY_MAX_SECONDS, ROSTER_LIVE_STEADY_SECONDS]).toEqual([1, 30, 60]);
    expect(rosterStreamDelay(1)).toBe(1_000);
    expect(rosterStreamDelay(20)).toBe(30_000);
  });
});
