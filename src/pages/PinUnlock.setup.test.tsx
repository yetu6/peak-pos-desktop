import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DeviceSessionProvider, useDeviceSession } from "../auth/DeviceSessionProvider";
import { generateDeviceKeyPair } from "../lib/deviceCrypto";
import type { SecretStore } from "../lib/deviceIdentity";
import type { OfflineAuthority } from "../lib/offlineAuthorization";
import { clearOperationalSession } from "../lib/operationalSession";
import { PinUnlock } from "./PinUnlock";

/**
 * A new waiter signs in at the till with the setup code their manager gave
 * them and chooses their own PIN there (owner, 2026-10-25). The real device
 * session and the real PIN screen, against a fetch that answers as Yetu's
 * sign-in does (fbc-peak internal/pos/service.go PINLogin, credentials.go
 * ChooseOwnPIN).
 */

/** Each answer goes through signing and Yetu's sign-in, slower while the whole suite runs. */
const ANSWERED = { timeout: 5_000 };

function eventually(check: () => void) {
  return waitFor(check, ANSWERED);
}

const WEAK_PIN_WORDS = "Choose your own six-digit PIN -- not the setup code, and not one anybody could guess like 123456 or 111111.";

interface Person {
  id: string;
  displayName: string;
  pin?: string;
  setupCode?: string;
  setupExpired?: boolean;
}

function answer(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeYetu(people: Person[]) {
  const signIns: Array<{ pin: string; newPin?: string; status: number }> = [];
  const log: string[] = [];
  const send = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/pos/device/challenges")) {
      log.push("challenge");
      return answer(201, {
        challengeId: "11111111-1111-1111-1111-111111111111",
        nonce: btoa("n".repeat(32)),
        expiresAt: "2099-01-01T00:00:00Z",
        propertyName: "Bahari QA Hotel",
        outletName: "Restaurant",
        terminalName: "Main till",
        staff: people.map((person) => ({
          id: person.id,
          displayName: person.displayName,
          staffSuffix: person.id.slice(-3),
          needsSetup: Boolean(person.setupCode),
        })),
      });
    }
    if (url.endsWith("/pos/sessions")) {
      const body = JSON.parse(String(init?.body)) as { staffId: string; pin: string; newPin?: string };
      const status = signIn(body);
      signIns.push({ pin: body.pin, newPin: body.newPin, status: status.status });
      log.push(`sign-in ${status.status}`);
      return status;
    }
    if (url.endsWith("/pos/device/roster/events")) return answer(503, { code: "REALTIME_UNAVAILABLE" });
    if (url.endsWith("/pos/catalog")) return answer(200, { outletId: "o1", outletName: "Restaurant", products: [] });
    if (url.endsWith("/pos/orders?active=true")) return answer(200, []);
    // The signed offline permission for the person signing in, which the till keeps sealed.
    if (url.endsWith("/offline-leases")) return answer(201, { keyId: "key-1", payloadB64: "bGVhc2U", signatureB64: "c2ln" });
    if (url.includes("/heartbeat")) return answer(204, null);
    throw new Error(`unexpected fetch: ${url}`);
  });

  function signIn(body: { staffId: string; pin: string; newPin?: string }): Response {
    const person = people.find((candidate) => candidate.id === body.staffId);
    if (!person) return answer(401, { code: "POS_PIN_UNAUTHORIZED" });
    if (person.setupCode) {
      if (person.setupExpired) return answer(401, { code: "POS_SETUP_CODE_EXPIRED", detail: "Ask your manager for a new setup code in Yetu, then try again." });
      if (body.pin !== person.setupCode) return answer(401, { code: "POS_PIN_UNAUTHORIZED" });
      if (!body.newPin) return answer(409, { code: "POS_PIN_SETUP_REQUIRED", detail: "Your setup code is right." });
      if (["123456", "111111"].includes(body.newPin) || body.newPin === person.setupCode) {
        return answer(422, { code: "VALIDATION_FAILED", detail: WEAK_PIN_WORDS });
      }
      person.pin = body.newPin;
      person.setupCode = undefined;
    } else if (body.pin !== person.pin) {
      return answer(401, { code: "POS_PIN_UNAUTHORIZED" });
    }
    return answer(201, {
      token: `ops_live${"x".repeat(40)}`,
      expiresAt: "2099-01-01T00:00:00Z",
      assurance: "RESTRICTED",
      tenantId: "t1",
      propertyId: "p1",
      outletId: "o1",
      terminalId: "terminal-1",
      staffId: person.id,
    });
  }

  return { send, signIns, log, people };
}

function memoryStore(initial: string): SecretStore {
  let value: string | null = initial;
  return {
    load: async () => value,
    save: async (next: string) => {
      value = next;
    },
  };
}

/** Who the device session lists as new, and where it is. */
function Probe() {
  const { phase, roster } = useDeviceSession();
  return (
    <>
      <div data-testid="phase">{phase}</div>
      <div data-testid="listed-new">{roster.filter((entry) => entry.needsSetup).map((entry) => entry.fullName).join(",")}</div>
    </>
  );
}

async function openTill(people: Person[], offlineAuthority?: OfflineAuthority) {
  const yetu = fakeYetu(people);
  vi.stubGlobal("fetch", yetu.send);
  const keys = await generateDeviceKeyPair();
  const store = memoryStore(
    JSON.stringify({ ...keys, deviceCode: "terminal-1", terminalId: "terminal-1", deviceCredential: "device-secret", approved: true }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeviceSessionProvider store={store} baseUrl="https://api.yetu.test" applyOpsToken={async () => undefined} offlineAuthority={offlineAuthority}>
        <Probe />
        <PinUnlock />
      </DeviceSessionProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Who's working?" }, ANSWERED);
  return yetu;
}

async function tapDigits(digits: string) {
  for (const digit of digits) await userEvent.click(screen.getByTestId(`pin-key-${digit}`));
}

function heading() {
  return screen.getByRole("heading", { level: 1 });
}

const NEEMA: Person = { id: "staff-neema-002", displayName: "Neema Mollel", setupCode: "246810" };
const AMINA: Person = { id: "staff-amina-001", displayName: "Amina Hassan", pin: "418205" };

afterEach(() => {
  vi.unstubAllGlobals();
  clearOperationalSession();
  localStorage.clear();
});

describe("a new person at the till", () => {
  it("is marked New, enters the setup code, chooses a PIN, must type it the same twice, and signs in", async () => {
    const yetu = await openTill([{ ...NEEMA }, { ...AMINA }]);
    expect(within(screen.getByTestId("roster-entry-staff-neema-002")).getByText("New")).toBeInTheDocument();
    expect(within(screen.getByTestId("roster-entry-staff-amina-001")).queryByText("New")).not.toBeInTheDocument();
    expect(screen.getByTestId("listed-new")).toHaveTextContent("Neema Mollel");

    await userEvent.click(screen.getByTestId("roster-entry-staff-neema-002"));
    expect(heading()).toHaveTextContent("Enter the setup code your manager gave you");
    await tapDigits("246810");

    // Yetu says the code is right: now their own PIN, twice.
    await eventually(() => expect(heading()).toHaveTextContent("Choose your own six-digit PIN"));
    expect(yetu.signIns).toEqual([{ pin: "246810", newPin: undefined, status: 409 }]);
    await tapDigits("583920");
    expect(heading()).toHaveTextContent("Type it again");
    await tapDigits("583921");
    expect(screen.getByTestId("pin-error")).toHaveTextContent("The two PINs were different. Choose your PIN again.");
    expect(heading()).toHaveTextContent("Choose your own six-digit PIN");
    expect(yetu.signIns).toHaveLength(1);

    await tapDigits("583920");
    await tapDigits("583920");
    await eventually(() => expect(screen.getByTestId("phase")).toHaveTextContent("ready"));
    expect(yetu.signIns[1]).toEqual({ pin: "246810", newPin: "583920", status: 201 });

    // Read again after signing in: the next time the list shows, Neema is no longer new.
    await eventually(() => expect(yetu.log.slice(yetu.log.indexOf("sign-in 201"))).toContain("challenge"));
    await eventually(() => expect(screen.getByTestId("listed-new")).toBeEmptyDOMElement());
  });

  it("takes the setup code and both PINs from a keyboard as well", async () => {
    const yetu = await openTill([{ ...NEEMA }]);
    await userEvent.click(screen.getByTestId("roster-entry-staff-neema-002"));
    (document.activeElement as HTMLElement | null)?.blur();
    for (const key of "246810") fireEvent.keyDown(window, { key });
    await eventually(() => expect(heading()).toHaveTextContent("Choose your own six-digit PIN"));
    // Focus is on the new keypad: digits typed there count too.
    await eventually(() => expect(screen.getByRole("group", { name: "PIN" })).toContainElement(document.activeElement as HTMLElement));
    await userEvent.keyboard("583920");
    expect(heading()).toHaveTextContent("Type it again");
    // A step the till takes by itself (no answer from Yetu) puts focus on its keypad too.
    await eventually(() => expect(screen.getByRole("group", { name: "PIN" })).toContainElement(document.activeElement as HTMLElement));
    await userEvent.keyboard("583920");
    await eventually(() => expect(screen.getByTestId("phase")).toHaveTextContent("ready"));
    expect(yetu.signIns.at(-1)).toEqual({ pin: "246810", newPin: "583920", status: 201 });
  });

  it("says so when the setup code has run out, and stays on the code", async () => {
    const yetu = await openTill([{ ...NEEMA, setupExpired: true }]);
    await userEvent.click(screen.getByTestId("roster-entry-staff-neema-002"));
    await tapDigits("246810");
    await eventually(() =>
      expect(screen.getByTestId("pin-error")).toHaveTextContent("This setup code has expired. Ask your manager for a new one."),
    );
    expect(heading()).toHaveTextContent("Enter the setup code your manager gave you");
    expect(yetu.signIns).toEqual([{ pin: "246810", newPin: undefined, status: 401 }]);
  });

  it("says a wrong setup code didn't match, counting it like a wrong PIN", async () => {
    await openTill([{ ...NEEMA }]);
    await userEvent.click(screen.getByTestId("roster-entry-staff-neema-002"));
    await tapDigits("246811");
    await eventually(() => expect(screen.getByTestId("pin-error")).toHaveTextContent("That setup code didn't match. Try again."));
    expect(heading()).toHaveTextContent("Enter the setup code your manager gave you");
    for (let attempt = 2; attempt <= 5; attempt += 1) await tapDigits("246811");
    await eventually(() =>
      expect(screen.getByTestId("pin-error")).toHaveTextContent(
        "Too many tries. Signing in may be paused for a minute — wait, then try again, or ask a manager.",
      ),
    );
  });

  it("starts again from the code when it ran out while the PIN was being chosen", async () => {
    const neema = { ...NEEMA };
    const yetu = await openTill([neema]);
    await userEvent.click(screen.getByTestId("roster-entry-staff-neema-002"));
    await tapDigits("246810");
    await eventually(() => expect(heading()).toHaveTextContent("Choose your own six-digit PIN"));
    await tapDigits("583920");
    neema.setupExpired = true;
    await tapDigits("583920");
    await eventually(() =>
      expect(screen.getByTestId("pin-error")).toHaveTextContent("This setup code has expired. Ask your manager for a new one."),
    );
    expect(heading()).toHaveTextContent("Enter the setup code your manager gave you");

    // A manager gives a new code: the PIN is chosen again from the start, and sent with the new code.
    neema.setupExpired = false;
    neema.setupCode = "975310";
    await tapDigits("975310");
    await eventually(() => expect(heading()).toHaveTextContent("Choose your own six-digit PIN"));
    await tapDigits("640271");
    await tapDigits("640271");
    await eventually(() => expect(screen.getByTestId("phase")).toHaveTextContent("ready"));
    expect(yetu.signIns.at(-1)).toEqual({ pin: "975310", newPin: "640271", status: 201 });
  });

  it("makes the till's offline check from the PIN chosen, never from the spent setup code", async () => {
    const authenticateStaff = vi.fn(async () => ({ state: "AUTHENTICATED" as const }));
    const offline: OfflineAuthority = {
      bindTerminal: vi.fn(),
      applyLifecycleEvent: vi.fn(),
      stageAuthorization: vi.fn(async () => ({ state: "STAGED" as const, hardExpiresAt: Date.now() + 3_600_000, staffCount: 1, catalogVersion: "v1", catalogDigest: "a".repeat(64), prerequisite: null })),
      clearStaffSession: vi.fn(async () => undefined),
      authenticateStaff,
      eligibilityStatus: vi.fn(async () => ({ state: "ELIGIBLE" as const })),
    };
    await openTill([{ ...NEEMA }], offline);
    await userEvent.click(screen.getByTestId("roster-entry-staff-neema-002"));
    await tapDigits("246810");
    await eventually(() => expect(heading()).toHaveTextContent("Choose your own six-digit PIN"));
    await tapDigits("583920");
    await tapDigits("583920");
    await eventually(() => expect(screen.getByTestId("phase")).toHaveTextContent("ready"));
    expect(authenticateStaff).toHaveBeenCalledWith("staff-neema-002", "583920");
    expect(authenticateStaff).not.toHaveBeenCalledWith(expect.anything(), "246810");
  });

  it("shows Yetu's own words when it refuses the PIN chosen, and asks for another", async () => {
    const yetu = await openTill([{ ...NEEMA }]);
    await userEvent.click(screen.getByTestId("roster-entry-staff-neema-002"));
    await tapDigits("246810");
    await eventually(() => expect(heading()).toHaveTextContent("Choose your own six-digit PIN"));
    await tapDigits("123456");
    await tapDigits("123456");
    await eventually(() => expect(screen.getByTestId("pin-error")).toHaveTextContent(WEAK_PIN_WORDS));
    expect(heading()).toHaveTextContent("Choose your own six-digit PIN");
    expect(yetu.signIns.at(-1)).toEqual({ pin: "246810", newPin: "123456", status: 422 });

    // The setup code is kept: a better PIN, twice, and they are in.
    await tapDigits("583920");
    await tapDigits("583920");
    await eventually(() => expect(screen.getByTestId("phase")).toHaveTextContent("ready"));
    expect(yetu.signIns.at(-1)).toEqual({ pin: "246810", newPin: "583920", status: 201 });
  });
});

describe("a list from before the person was given a setup code", () => {
  it("moves to choosing a PIN when Yetu says the PIN typed is their setup code", async () => {
    // A manager has just given Amina a new setup code; this till's list still shows her as she was.
    const yetu = await openTill([{ ...AMINA }]);
    expect(within(screen.getByTestId("roster-entry-staff-amina-001")).queryByText("New")).not.toBeInTheDocument();
    yetu.people[0].setupCode = "135790";

    await userEvent.click(screen.getByTestId("roster-entry-staff-amina-001"));
    expect(heading()).toHaveTextContent("Enter your PIN");
    await tapDigits("135790");
    await eventually(() => expect(heading()).toHaveTextContent("Choose your own six-digit PIN"));
    expect(screen.queryByTestId("pin-error")).not.toBeInTheDocument();
    await tapDigits("583920");
    await tapDigits("583920");
    await eventually(() => expect(screen.getByTestId("phase")).toHaveTextContent("ready"));
    expect(yetu.signIns).toEqual([
      { pin: "135790", newPin: undefined, status: 409 },
      { pin: "135790", newPin: "583920", status: 201 },
    ]);
  });

  it("goes through the same steps for a person who typed their staff number", async () => {
    const yetu = await openTill([{ ...AMINA }]);
    yetu.people[0].setupCode = "135790";
    await userEvent.click(screen.getByTestId("staff-manual-entry"));
    await userEvent.type(screen.getByTestId("staff-number"), "staff-amina-001");
    await tapDigits("135790");
    await eventually(() => expect(heading()).toHaveTextContent("Choose your own six-digit PIN"));
    // The number can't change half-way; starting again is the way back.
    expect(screen.queryByTestId("staff-number")).not.toBeInTheDocument();
    await tapDigits("583920");
    await tapDigits("583920");
    await eventually(() => expect(screen.getByTestId("phase")).toHaveTextContent("ready"));
    expect(yetu.signIns.at(-1)).toEqual({ pin: "135790", newPin: "583920", status: 201 });
  });
});
