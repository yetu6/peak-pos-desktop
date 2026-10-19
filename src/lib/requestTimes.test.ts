import { afterEach, describe, expect, it } from "vitest";
import { REQUEST_TIMES_KEPT, noteRequestTime, requestTimesWords, resetRequestTimes } from "./requestTimes";

// F-255 (2026-10-20): an add took 0.8–1.2 s on Bahari's till though Yetu
// answered in 45–131 ms. Support reads how long Yetu's answers take as the till
// waits for them, on the till itself.
describe("how long Yetu takes to answer this till", () => {
  afterEach(() => resetRequestTimes());

  it("says nothing was asked yet on a fresh till", () => {
    expect(requestTimesWords()).toBe("Nothing asked yet");
  });

  it("gives the usual time for changes and for look-ups apart", () => {
    for (const ms of [410, 380, 1150]) noteRequestTime("POST", ms);
    noteRequestTime("PATCH", 430);
    for (const ms of [190, 230, 210]) noteRequestTime("GET", ms);
    expect(requestTimesWords()).toBe("Changes 0.42 s · Look-ups 0.21 s (usual of the last 7)");
  });

  it("says a slow answer in seconds", () => {
    noteRequestTime("POST", 2_480);
    expect(requestTimesWords()).toBe("Changes 2.5 s (usual of the last 1)");
  });

  it("keeps only the latest answers", () => {
    for (let index = 0; index < REQUEST_TIMES_KEPT; index += 1) noteRequestTime("GET", 3_000);
    for (let index = 0; index < REQUEST_TIMES_KEPT; index += 1) noteRequestTime("GET", 200);
    expect(requestTimesWords()).toBe(`Look-ups 0.20 s (usual of the last ${REQUEST_TIMES_KEPT})`);
  });
});
