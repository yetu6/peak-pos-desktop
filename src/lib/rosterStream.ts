import {
  ROSTER_LIVE_RETRY_FIRST_SECONDS,
  ROSTER_LIVE_RETRY_MAX_SECONDS,
  ROSTER_LIVE_STEADY_SECONDS,
} from "../access/accessSettings";
import { retryAfterSecondsOf } from "./deviceAuth";

/**
 * The sign-in screen's live staff list (owner, 2026-10-25: a new waiter
 * appears at the till "immediately ... not manually but auto"). Yetu keeps a
 * server-sent event stream open to the paired till (fbc-peak POST
 * /pos/device/roster/events) and sends a bare `roster` event whenever the
 * property's staff list changes; the till then reads its list again through
 * its usual device challenge. The stream carries no names.
 */

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Reads server-sent events from text as it arrives, in pieces of any size: a
 * line, or the blank line that ends an event, may be split across pieces.
 * Comments (lines starting with ":", Yetu's keep-alive) are skipped.
 */
export function createSseReader(onEvent: (event: SseEvent) => void): { push: (text: string) => void } {
  let pending = "";
  let name = "";
  let data: string[] = [];

  function line(text: string) {
    if (text === "") {
      // An event with no data is not delivered (the event stream rules).
      if (data.length > 0) onEvent({ event: name || "message", data: data.join("\n") });
      name = "";
      data = [];
      return;
    }
    // A comment (":keep-alive") has an empty field name, so it is skipped like any field not read here.
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") name = value;
    else if (field === "data") data.push(value);
  }

  return {
    push(text: string) {
      pending += text;
      let start = 0;
      for (let at = 0; at < pending.length; at += 1) {
        const char = pending[at];
        if (char !== "\n" && char !== "\r") continue;
        // A \r at the very end may be the first half of \r\n: wait for the next piece.
        if (char === "\r" && at === pending.length - 1) break;
        line(pending.slice(start, at));
        if (char === "\r" && pending[at + 1] === "\n") at += 1;
        start = at + 1;
      }
      pending = pending.slice(start);
    },
  };
}

export interface RosterStreamRetry {
  firstMs: number;
  maxMs: number;
  /** A connection that stayed up this long has recovered: the next drop starts from firstMs. */
  steadyMs: number;
}

export const ROSTER_STREAM_RETRY: RosterStreamRetry = {
  firstMs: ROSTER_LIVE_RETRY_FIRST_SECONDS * 1000,
  maxMs: ROSTER_LIVE_RETRY_MAX_SECONDS * 1000,
  steadyMs: ROSTER_LIVE_STEADY_SECONDS * 1000,
};

/** The wait before the nth try in a row (1, 2, 4 … seconds, never more than the cap). */
export function rosterStreamDelay(attempt: number, retry: RosterStreamRetry = ROSTER_STREAM_RETRY): number {
  return Math.min(retry.firstMs * 2 ** Math.max(0, attempt - 1), retry.maxMs);
}

export interface RosterStreamOptions {
  baseUrl: string;
  terminalId: string;
  deviceCredential: string;
  /** Called on each `roster` event, and once after a reconnect: a change may have come while the line was down. */
  onRoster: () => void;
  /** Aborting ends the stream and every wait: the till left its sign-in screen. */
  signal: AbortSignal;
  retry?: RosterStreamRetry;
  /** Tests pass their own; the till uses the web view's fetch (see followRosterStream). */
  fetch?: typeof fetch;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

/**
 * Keeps the roster stream open until `signal` aborts, trying again after a
 * capped, doubling wait whenever it drops or cannot open. A till Yetu does not
 * know (401/403), live updates being off (503) or too many connections (429)
 * wait the longest (429: as long as Yetu asked): the 30-second refresh keeps
 * the list up to date meanwhile. Never rejects.
 *
 * It uses the web view's own fetch, not yetuFetch: in the till yetuFetch sends
 * from the native side, which hands an answer over only once all of it has
 * arrived, and this one never ends.
 */
export async function followRosterStream(options: RosterStreamOptions): Promise<void> {
  const { signal } = options;
  const retry = options.retry ?? ROSTER_STREAM_RETRY;
  const send = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const wait = options.wait ?? waitUnlessAborted;
  const now = options.now ?? Date.now;
  const url = `${options.baseUrl.replace(/\/$/, "")}/api/v1/pos/device/roster/events`;
  const body = JSON.stringify({ terminalId: options.terminalId, deviceCredential: options.deviceCredential });
  let tries = 0;
  let connectedBefore = false;

  while (!signal.aborted) {
    const startedAt = now();
    let refusedFor: number | null = null;
    try {
      const response = await send(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body,
        cache: "no-store",
        signal,
      });
      if (response.ok && response.body) {
        if (connectedBefore) options.onRoster();
        connectedBefore = true;
        await readRosterEvents(response.body, signal, options.onRoster);
      } else {
        refusedFor = await refusalWait(response, retry);
      }
    } catch {
      // No network, or the line dropped: try again below.
    }
    if (signal.aborted) return;
    if (now() - startedAt >= retry.steadyMs) tries = 0;
    tries += 1;
    await wait(refusedFor ?? rosterStreamDelay(tries, retry), signal);
  }
}

async function refusalWait(response: Response, retry: RosterStreamRetry): Promise<number | null> {
  if (response.status === 429) return Math.max(retry.maxMs, (await retryAfterSecondsOf(response)) * 1000);
  void response.body?.cancel().catch(() => undefined);
  if (response.status === 401 || response.status === 403 || response.status === 503) return retry.maxMs;
  return null;
}

async function readRosterEvents(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onRoster: () => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const sse = createSseReader((event) => {
    if (event.event === "roster") onRoster();
  });
  const stop = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", stop, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) return;
      sse.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

function waitUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}
