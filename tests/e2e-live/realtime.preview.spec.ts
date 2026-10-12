/**
 * The production build's realtime, against the live API: pair, sign in from
 * the names, open a shift, and the connection pill reaches Live. The device
 * key is made in Node with the till's own generator (the production build
 * serves no source modules for the page to import), then stored the way the
 * browser-compatibility identity is (src/lib/deviceIdentity.ts).
 * Run after the live suite, on a fresh seed: tests/e2e-live/live-api.sh seed.
 */
import { expect, test } from "@playwright/test";
import { generateDeviceKeyPair } from "../../src/lib/deviceCrypto";
import { WebSession, loadSeededProperty, typed } from "./liveApi";
import { LIVE_API_URL } from "./liveSettings";

test("the production build's realtime goes Live", async ({ page }) => {
  const seeded = loadSeededProperty();
  const web = new WebSession();
  await web.signIn(seeded.ownerEmail);
  const keys = await generateDeviceKeyPair();
  await page.addInitScript((identity) => {
    if (!localStorage.getItem("peak-pos-device-identity")) {
      localStorage.setItem("peak-pos-device-identity", JSON.stringify({ ...identity, approved: false }));
    }
  }, keys);

  await page.goto("/");
  await page.getByTestId("peak-url").fill(LIVE_API_URL);
  await page.getByTestId("save-peak-url").click();
  await page.getByRole("button", { name: "Get a code" }).click();
  const shown = ((await page.getByTestId("pairing-code").textContent()) ?? "").trim();
  const property = `/api/v1/organizations/${seeded.organizationId}/properties/${seeded.propertyId}`;
  const found = await web.call<{ pairingRequestId: string }>(`${property}/pos/pairing-requests/lookup`, {
    method: "POST",
    body: { pairingCode: shown },
  });
  await web.call(`${property}/pos/pairing-requests/${found.pairingRequestId}/approve`, {
    method: "POST",
    body: { outletId: seeded.outletId, terminalName: `Preview till ${crypto.randomUUID().slice(0, 6)}` },
  });

  await expect(page.getByTestId("staff-roster")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`roster-entry-${seeded.cashierStaffId}`).click();
  for (const digit of seeded.cashierPin) await page.getByTestId(`pin-key-${digit}`).click();
  await page.getByTestId("opening-float").fill(typed(5_000_000));
  await page.getByTestId("open-shift").click();
  await expect(page.getByTestId("pos-register")).toBeVisible();
  await expect(page.getByTestId("conn-label")).toHaveText("Live", { timeout: 15_000 });
});
