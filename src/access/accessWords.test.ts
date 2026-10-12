import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DeviceNotApprovedError,
  DeviceRevokedError,
  StaffLoginRejectedError,
  humanDeviceError,
} from "../lib/deviceAuth";
import { validatePeakApiUrl } from "../lib/peakConfig";
import {
  PIN_LENGTH,
  PIN_PAUSE_AFTER_FAILURES,
  ROSTER_SEARCH_AFTER,
} from "./accessSettings";
import {
  KNOWN_PROVIDER_MESSAGES,
  accessNotice,
  addressProblemWords,
  countdownWords,
  groupPairingCode,
  offlineReadinessWords,
  pinNotice,
} from "./accessWords";

const root = process.cwd();
const providerSource = readFileSync(join(root, "src/auth/DeviceSessionProvider.tsx"), "utf8");
const deviceAuthSource = readFileSync(join(root, "src/lib/deviceAuth.ts"), "utf8");
const idleSource = readFileSync(join(root, "src/components/IdleLockOverlay.tsx"), "utf8");

/** A code, an engineering name or the old product name leaking into words. */
const NOT_PLAIN = /\bPeak\b|\bterminal\b|\bauthori[sz]|\bregister\b|\bcertif|\blease\b|\bcatalog\b|[A-Z]{3,}_[A-Z]/i;

describe("settings that mirror the backend's rules", () => {
  it("knows a PIN is 6 digits and pauses after 5 wrong tries", () => {
    expect(PIN_LENGTH).toBe(6);
    expect(PIN_PAUSE_AFTER_FAILURES).toBe(5);
    expect(ROSTER_SEARCH_AFTER).toBe(12);
  });
});

describe("every message the sign-in code can show has plain words", () => {
  function stringsIn(source: string, pattern: RegExp): string[] {
    return [...source.matchAll(pattern)].map((match) => match[1]);
  }

  it("covers each message the device session sets", () => {
    const set = stringsIn(providerSource, /setError\(\s*"([^"]+)"/g);
    const ternary = stringsIn(providerSource, /\?\s*"([^"]+)"\s*:\s*/g).concat(
      stringsIn(providerSource, /:\s*"([^"]+)"\);/g),
    );
    const offline = stringsIn(
      providerSource.slice(providerSource.indexOf("function offlineEligibilityMessage")),
      /return\s+"([^"]+)"/g,
    );
    const all = [...new Set([...set, ...ternary, ...offline])];
    expect(all.length).toBeGreaterThan(10);
    expect(all.filter((message) => !KNOWN_PROVIDER_MESSAGES.includes(message))).toEqual([]);
  });

  it("covers each message the device sign-in code words", () => {
    const fn = deviceAuthSource.slice(deviceAuthSource.indexOf("export function humanDeviceError"));
    const messages = stringsIn(fn.slice(0, fn.indexOf("\n}\n")), /return\s+"([^"]+)"/g);
    expect(messages.length).toBeGreaterThan(5);
    expect(messages.filter((message) => !KNOWN_PROVIDER_MESSAGES.includes(message))).toEqual([]);
  });

  it("covers the idle lock's own reason", () => {
    const reasons = stringsIn(idleSource, /switchStaff\("([^"]+)"\)/g);
    expect(reasons).toEqual(["Locked after idle"]);
    expect(KNOWN_PROVIDER_MESSAGES).toContain("Locked after idle");
  });

  it("never shows an engineering word or the old product name", () => {
    for (const message of KNOWN_PROVIDER_MESSAGES) {
      const notice = accessNotice(message);
      expect(notice, message).not.toBeNull();
      expect(notice!.words, message).not.toMatch(NOT_PLAIN);
    }
    // The originals do use them, which is why they are reworded.
    expect(KNOWN_PROVIDER_MESSAGES.filter((message) => NOT_PLAIN.test(message)).length).toBeGreaterThan(5);
  });
});

describe("access notices", () => {
  it("says nothing when there is nothing to say", () => {
    expect(accessNotice(null)).toBeNull();
    expect(accessNotice("")).toBeNull();
  });

  it("tells a person whose session ended to carry on, as information, not an error", () => {
    expect(accessNotice("Session expired — enter your PIN again")).toEqual({
      kind: "session-ended",
      tone: "info",
      words: "Your session ended. Enter your PIN to carry on.",
    });
    expect(accessNotice("Locked after idle")?.tone).toBe("info");
  });

  it("names the pairing outcomes in words", () => {
    expect(accessNotice(humanDeviceError(new Error("pairing denied")))).toMatchObject({
      kind: "declined",
      words: "A manager declined this till. Ask them why, then get a new code.",
    });
    expect(accessNotice("This pairing was denied. Generate a new code.")?.kind).toBe("declined");
    expect(accessNotice("This code expired. Generate a new one.")?.kind).toBe("expired");
    expect(accessNotice(humanDeviceError(new DeviceRevokedError()))?.kind).toBe("revoked");
    expect(accessNotice(humanDeviceError(new DeviceNotApprovedError()))?.kind).toBe("not-approved");
  });

  it("says when Yetu cannot be reached", () => {
    expect(accessNotice(humanDeviceError(new Error("Failed to fetch")))).toMatchObject({
      kind: "unreachable",
      words: "Can't reach Yetu. Check the internet connection, then try again.",
    });
    expect(accessNotice(humanDeviceError(new Error("HTTP 503")))?.kind).toBe("server-busy");
  });

  it("never shows a message it does not know as it came", () => {
    expect(accessNotice("Some new internal failure: ECONNRESET")).toEqual({
      kind: "something-wrong",
      tone: "danger",
      words: "Something went wrong. Try again.",
    });
  });
});

describe("PIN notices follow the backend's pause rule", () => {
  const rejected = humanDeviceError(new StaffLoginRejectedError());

  it("says the PIN didn't match for a person chosen from the list", () => {
    expect(pinNotice(rejected, { failures: 1, manual: false })?.words).toBe("That PIN didn't match. Try again.");
  });

  it("says the staff number and PIN didn't match when typed by hand", () => {
    expect(pinNotice(rejected, { failures: 1, manual: true })?.words).toBe(
      "That staff number and PIN didn't match. Try again.",
    );
  });

  it("says the PIN is paused once the backend pauses it", () => {
    const words = pinNotice(rejected, { failures: PIN_PAUSE_AFTER_FAILURES, manual: false })?.words;
    expect(words).toBe("Too many tries. This PIN is paused for at least a minute. Wait, then try again, or ask a manager.");
    expect(pinNotice(rejected, { failures: PIN_PAUSE_AFTER_FAILURES - 1, manual: false })?.words).toBe(
      "That PIN didn't match. Try again.",
    );
  });

  it("leaves other messages to the general words", () => {
    expect(pinNotice("Session expired — enter your PIN again", { failures: 0, manual: false })?.kind).toBe("session-ended");
  });
});

describe("server address check", () => {
  it("explains each address problem in words, for the same rules the till enforces", () => {
    const words = (raw: string) => {
      const check = validatePeakApiUrl(raw);
      return check.ok ? null : addressProblemWords(check.error);
    };
    expect(words("")).toBe("Type the server address.");
    expect(words("not an address")).toBe("That doesn't look like an address. Check it and try again.");
    expect(words("http://yetu.example.com")).toBe("The address must start with https://");
    expect(words("ftp://yetu.example.com")).toBe("The address must start with https://");
    expect(words("https://yetu.example.com")).toBeNull();
    expect(addressProblemWords("anything else")).toBe("Check the address and try again.");
  });
});

describe("small formats", () => {
  it("writes a countdown as minutes and seconds", () => {
    expect(countdownWords(20)).toBe("0:20");
    expect(countdownWords(8)).toBe("0:08");
    expect(countdownWords(581)).toBe("9:41");
    expect(countdownWords(-3)).toBe("0:00");
  });

  it("groups a pairing code so it can be read out", () => {
    expect(groupPairingCode("ABCDE-FGHIJ")).toBe("ABCDE-FGHIJ");
    expect(groupPairingCode("abcdefghij")).toBe("ABCDE-FGHIJ");
    expect(groupPairingCode("7F3K9ABC")).toBe("7F3K-9ABC");
  });

  it("says what offline readiness means for the person, in words", () => {
    expect(offlineReadinessWords("ELIGIBLE")).toBe("If the internet drops, this till can keep taking cash.");
    expect(offlineReadinessWords("CATALOG_REQUIRED")).toBe(
      "Taking cash without internet isn't ready yet. It will be after a sign-in with a connection.",
    );
    expect(offlineReadinessWords("STORAGE_UNHEALTHY")).toBe("This till can't take cash without internet.");
    expect(offlineReadinessWords("ELIGIBLE")).not.toMatch(NOT_PLAIN);
  });
});
