/**
 * What every live till run does the same way: watch the till's calls to the
 * live API, tap like a person, and bring a till from a fresh browser to a
 * signed-in person with an open shift (set the server address, pair it with
 * the owner's approval through the API, PIN sign-in, open the shift).
 * Shared by till.live.spec.ts and orders-kitchen.live.spec.ts.
 */
import { expect, type Locator, type Page, type Response } from "@playwright/test";
import type { SeededProperty, WebSession } from "./liveApi";
import { typed } from "./liveApi";
import { LIVE_API_URL } from "./liveSettings";

export interface Shift {
  id: string;
  status: string;
  openingCashMinor: number;
  expectedCashMinor: number;
  countedCashMinor?: number;
  varianceMinor?: number;
}

/** The next response from the live API to `method path`, set up before the action that causes it. */
export function nextApi(page: Page, method: string, path: RegExp, matches?: (response: Response) => boolean): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.url().startsWith(LIVE_API_URL) &&
      response.request().method() === method &&
      path.test(new URL(response.url()).pathname) &&
      (matches ? matches(response) : true),
  );
}

export async function body<T>(pending: Promise<Response>, status?: number): Promise<T> {
  const response = await pending;
  if (status !== undefined) expect(response.status(), `${response.request().method()} ${response.url()}`).toBe(status);
  else expect(response.ok(), `${response.request().method()} ${response.url()} -> ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

/**
 * Taps like a person. While the till is signed in, its idle-lock countdown
 * ("Locking in 0:10 ... Touch anywhere to stay signed in") covers the whole
 * screen from a quarter of a second after the last touch, and takes the next
 * tap for itself. A person then taps again; so does this, and counts the taps
 * the countdown took (reported as a defect by the specs).
 */
export function tapper(page: Page) {
  let swallowed = 0;
  async function tap(target: Locator): Promise<void> {
    await expect(target).toBeVisible();
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await target.click({ timeout: 1_000 });
        return;
      } catch (error) {
        // Only when the countdown itself is what took the tap.
        if (!/idle-lock-overlay[^\n]*intercepts pointer events/.test(String(error))) throw error;
        const box = await target.boundingBox();
        if (!box) throw error;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        swallowed++;
      }
    }
    throw new Error("the idle-lock countdown kept taking the tap");
  }
  async function pin(prefix: string, digits: string): Promise<void> {
    for (const digit of digits) await tap(page.getByTestId(`${prefix}-${digit}`));
  }
  return { tap, pin, swallowed: () => swallowed };
}

/** Set the server address on a fresh till (with the browser stand-in for the OS key store). */
export async function setServerAddress(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("setup-screen")).toBeVisible();
  // A plain browser has no OS secure store: the till's own browser-compatibility identity.
  await page.evaluate(async (modulePath) => {
    const { generateDeviceKeyPair } = (await import(/* @vite-ignore */ modulePath)) as {
      generateDeviceKeyPair: () => Promise<{ privateKeyPkcs8: string; publicKeySpki: string }>;
    };
    const keys = await generateDeviceKeyPair();
    localStorage.setItem("peak-pos-device-identity", JSON.stringify({ ...keys, approved: false }));
  }, "/src/lib/deviceCrypto.ts");
  await page.getByTestId("peak-url").fill(LIVE_API_URL);
  await page.getByTestId("save-peak-url").click();
  await expect(page.getByTestId("pairing-screen")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("peak-pos-api-url"))).toBe(LIVE_API_URL);
}

/**
 * Pair: the till shows a code and the owner approves it in Yetu for the
 * seeded outlet, in `mode` (POS unless given). Returns the till's own ask for
 * who works here (a device challenge, still to be answered), which carries the roster.
 */
export async function pairTill(
  page: Page,
  web: WebSession,
  seeded: SeededProperty,
  approval: { terminalName: string; mode?: string },
): Promise<{ roster: Promise<Response> }> {
  const issued = nextApi(page, "POST", /^\/api\/v1\/pos\/pairing-requests$/);
  await page.getByRole("button", { name: "Get a code" }).click();
  const pairing = await body<{ pairingRequestId: string; pairingCode: string }>(issued, 201);
  const shown = (await page.getByTestId("pairing-code").textContent())?.trim() ?? "";
  expect(shown.replace(/-/g, "")).toBe(pairing.pairingCode.replace(/-/g, "").toUpperCase());

  // The manager types the code the till shows.
  const property = `/api/v1/organizations/${seeded.organizationId}/properties/${seeded.propertyId}`;
  const found = await web.call<{ pairingRequestId: string }>(`${property}/pos/pairing-requests/lookup`, {
    method: "POST",
    body: { pairingCode: shown },
  });
  expect(found.pairingRequestId).toBe(pairing.pairingRequestId);
  const roster = nextApi(page, "POST", /^\/api\/v1\/pos\/device\/challenges$/);
  const approved = await web.call<{ terminalId: string }>(`${property}/pos/pairing-requests/${pairing.pairingRequestId}/approve`, {
    method: "POST",
    body: { outletId: seeded.outletId, terminalName: approval.terminalName, ...(approval.mode ? { mode: approval.mode } : {}) },
  });
  expect(approved.terminalId).toBeTruthy();
  // The till finds the approval by itself and asks who is working.
  await expect(page.getByTestId("pin-screen")).toBeVisible({ timeout: 30_000 });
  // In an object: an async function would otherwise wait for the answer itself.
  return { roster };
}

/** A person picks their name on the roster and types their PIN; returns the catalog the till then loads. */
export async function signInWithPin(
  page: Page,
  roster: Promise<Response>,
  staffId: string,
  digits: string,
  pin: (prefix: string, digits: string) => Promise<void>,
): Promise<{ staff: Array<{ id: string; displayName: string }>; catalogResponse: Promise<Response> }> {
  const staff = (await body<{ staff: Array<{ id: string; displayName: string }> }>(roster, 201)).staff;
  await expect(page.getByTestId("staff-roster"), "the PIN screen opens on the names once the roster has arrived").toBeVisible({ timeout: 5_000 });
  await page.getByTestId(`roster-entry-${staffId}`).click();
  const signedIn = nextApi(page, "POST", /^\/api\/v1\/pos\/sessions$/);
  const catalogResponse = nextApi(page, "GET", /^\/api\/v1\/pos\/catalog$/);
  await pin("pin-key", digits);
  const session = await body<{ staffId: string }>(signedIn, 201);
  expect(session.staffId).toBe(staffId);
  return { staff, catalogResponse };
}

/** Count the float into the drawer and open the shift. */
export async function openShift(page: Page, floatMinor: number, tap: (target: Locator) => Promise<void>): Promise<Shift> {
  await expect(page.getByTestId("shell-state")).toHaveText("NO_SHIFT");
  await page.getByTestId("opening-float").fill(typed(floatMinor));
  const opened = nextApi(page, "POST", /^\/api\/v1\/pos\/shifts$/);
  await tap(page.getByTestId("open-shift"));
  const shift = await body<Shift>(opened, 201);
  expect(shift.status).toBe("OPEN");
  expect(shift.openingCashMinor).toBe(floatMinor);
  await expect(page.getByTestId("pos-register")).toBeVisible();
  await expect(page.getByTestId("shell-state")).toHaveText("OPERATIONAL");
  return shift;
}

/**
 * Print order shows its papers before it prints (owner, 2026-10-21): this taps the sheet's Print, as a cashier does.
 * `tap(send-order)` or Pay on an order with new items (Pay sends them first, showing the same papers) opens that sheet.
 */
export async function printShownPapers(page: Page, tap: (target: Locator) => Promise<void>): Promise<void> {
  await tap(page.getByTestId("paper-print"));
}

/** Pay on an order that may still have new items: when the papers are shown first, Print them; the payment follows. */
export async function payAfterPapers(page: Page, tap: (target: Locator) => Promise<void>, pay: Locator): Promise<void> {
  await tap(pay);
  const papers = page.getByTestId("paper-print");
  if (await papers.isVisible({ timeout: 1_500 }).catch(() => false)) await tap(papers);
}
