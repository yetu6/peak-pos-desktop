/**
 * A cashier's shift on the redesigned till, in Chromium, against a live Yetu
 * API: the real app from Vite's dev server (no visual fixture), the real
 * fbc-peak routes, a real database. Nothing is mocked and no money figure is
 * written into this file: every amount checked on screen is the one the API
 * returned to the till (read from the till's own responses), or the cash the
 * cashier typed.
 *
 * Steps: set the server address -> pair (the owner approves through the API,
 * as the journey does) -> PIN sign-in -> open the shift with a float -> add an
 * item with options and one without -> send to the kitchen -> part payment in
 * cash, the rest by mobile money -> a cash sale that gives change -> cash out,
 * approved by a different supervisor -> close the shift (blind count, check,
 * a manager approves the shortfall).
 *
 * Three checks were soft when this was written (2026-10-12), each a till
 * defect then, and are hard now that the till is fixed: the PIN screen opens
 * on the names once they arrive, the realtime pill reaches Live, and no tap is
 * lost to the idle-lock countdown.
 *
 * What a plain browser cannot be, and what this run does instead:
 * - The Tauri shell keeps the device key in the OS secure store (Rust
 *   ensure_device_identity / sign_device_challenge). A browser has no such
 *   store, so before Connect the page stores the browser-compatibility
 *   identity the till's own code supports (src/lib/deviceIdentity.ts: a
 *   WebCrypto Ed25519 key from src/lib/deviceCrypto.ts in localStorage). The
 *   pairing, the challenge signature and the PIN sign-in are then the real ones.
 * - Printing: the till prints through Rust (print_document). In a browser
 *   every print job is claimed and reported back to Yetu as failed with "No
 *   printer is configured"; this run records those calls, it prints nothing.
 * - Realtime: a browser cannot put a bearer token on a WebSocket, so the till
 *   uses the dev bridge (scripts/realtime-bridge.mjs), started by the config.
 * - Offline cash is not exercised (S6).
 *
 * Run (see tests/e2e-live/live-api.sh):
 *   tests/e2e-live/live-api.sh db && tests/e2e-live/live-api.sh seed
 *   tests/e2e-live/live-api.sh api &          # keep it running
 *   eval "$(tests/e2e-live/live-api.sh env)"; export PEAK_JOURNEY_BASE_URL PEAK_JOURNEY_MAMA_ROSE
 *   bunx playwright test -c tests/e2e-live/playwright.config.ts
 * Each run needs a freshly seeded restaurant (seed again): a run leaves its
 * till paired and its shift closed.
 */
import { expect, test, type Response } from "@playwright/test";
import { WebSession, ensurePlainDish, loadSeededProperty, tsh, typed } from "./liveApi";
import { LIVE_API_URL } from "./liveSettings";
import { body, nextApi, openShift, pairTill, setServerAddress, signInWithPin, tapper, type Shift } from "./liveTill";

/** The cash the cashier counts into the drawer when the shift opens. */
const OPENING_FLOAT_MINOR = 5_000_000;
/** The cash taken out for the gas delivery, approved by a supervisor. */
const CASH_OUT_MINOR = 500_000;
/** How far short the closing count is, so a manager must approve it. */
const SHORTFALL_MINOR = 100_000;
/** Cash payments are typed in whole thousands of shillings. */
const THOUSAND_TSH = 100_000;

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  items: Array<{ name: string; productId: string; modifiers?: Array<{ optionName: string }> }>;
}
interface Tender {
  paymentId: string;
  orderClosed: boolean;
  paidMinor: number;
  remainingMinor: number;
}
interface Catalog {
  products: Array<{ id: string; name: string; priceMinor: number; modifierGroups?: Array<{ options?: Array<{ id: string; priceDeltaMinor: number }> }> }>;
}

test("a cashier's shift on the redesigned till, against the live API", async ({ page }, testInfo) => {
  const seeded = loadSeededProperty();
  const web = new WebSession();
  await web.signIn(seeded.ownerEmail);
  const plainDish = await ensurePlainDish(web, seeded);

  const { tap, pin, swallowed } = tapper(page);

  // Evidence: every call the till made to the API, and anything the page threw.
  const calls: string[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("response", (response) => {
    if (response.url().startsWith(LIVE_API_URL)) {
      const url = new URL(response.url());
      calls.push(`${response.request().method()} ${url.pathname}${url.search} -> ${response.status()}`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  let roster: Promise<Response> | null = null;
  const connection: string[] = [];
  let staff: Array<{ id: string; displayName: string }> = [];
  let catalog: Catalog | null = null;
  let shift: Shift | null = null;
  let firstOrder: Order | null = null;
  let cashPartMinor = 0;
  let secondOrder: Order | null = null;

  await test.step("1. Set the server address", async () => {
    await setServerAddress(page);
  });

  await test.step("2. Pair: the till shows a code, the owner approves it in Yetu", async () => {
    ({ roster } = await pairTill(page, web, seeded, { terminalName: `Front till ${crypto.randomUUID().slice(0, 6)}` }));
  });

  await test.step("3. The cashier signs in with their PIN", async () => {
    const signedIn = await signInWithPin(page, roster!, seeded.cashierStaffId, seeded.cashierPin, pin);
    staff = signedIn.staff;
    expect(staff.map((person) => person.id)).toEqual(expect.arrayContaining([seeded.cashierStaffId, seeded.managerStaffId]));
    catalog = await body<Catalog>(signedIn.catalogResponse);
    await expect(page.getByTestId("shell-state")).toHaveText("NO_SHIFT");
  });

  await test.step("4. Open the shift with a float", async () => {
    shift = await openShift(page, OPENING_FLOAT_MINOR, tap);
    // Realtime through the dev bridge: the connection pill should reach Live.
    await expect(page.getByTestId("conn-label"), "the till's realtime connection goes Online through the bridge").toHaveText("Online", {
      timeout: 5_000,
    });
    connection.push(`after opening the shift: ${await page.getByTestId("conn-label").textContent()}`);
  });

  await test.step("5. Add an item with options, then one without", async () => {
    const special = catalog!.products.find((product) => product.id === seeded.productId)!;
    const cheese = special.modifierGroups!.flatMap((group) => group.options ?? []).find((option) => option.id === seeded.cheeseOptionId)!;
    await tap(page.getByTestId("nav-new"));
    await tap(page.getByTestId(`menu-${special.name}`));
    await expect(page.getByTestId("modifier-dialog")).toBeVisible();
    await tap(page.getByTestId(`modifier-option-${seeded.cheeseOptionId}`));
    await expect(page.getByTestId("modifier-confirm-add")).toHaveText(`Add to order · ${tsh(special.priceMinor + cheese.priceDeltaMinor)}`);
    const created = nextApi(page, "POST", /^\/api\/v1\/pos\/orders$/);
    let added = nextApi(page, "POST", /^\/api\/v1\/pos\/orders\/[^/]+\/items$/);
    await tap(page.getByTestId("modifier-confirm-add"));
    await body<Order>(created, 201);
    let order = await body<Order>(added);
    expect(order.items.find((line) => line.productId === special.id)?.modifiers?.map((modifier) => modifier.optionName)).toEqual(["Cheese"]);

    added = nextApi(page, "POST", /^\/api\/v1\/pos\/orders\/[^/]+\/items$/);
    await tap(page.getByTestId(`menu-${plainDish.name}`));
    order = await body<Order>(added);
    expect(order.items).toHaveLength(2);
    await expect(page.getByTestId(`cart-${special.name}`)).toContainText("Cheese");
    await expect(page.getByTestId(`cart-${plainDish.name}`)).toBeVisible();
    await expect(page.getByTestId("cart-preview-total")).toHaveText(tsh(order.totalMinor));
    firstOrder = order;
  });

  await test.step("6. Send to the kitchen", async () => {
    const sent = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${firstOrder!.id}/send$`));
    const fresh = nextApi(page, "GET", new RegExp(`^/api/v1/pos/orders/${firstOrder!.id}$`));
    await tap(page.getByTestId("send-order"));
    expect((await sent).ok()).toBe(true);
    firstOrder = await body<Order>(fresh);
    expect(firstOrder.status).toBe("SENT");
    await expect(page.getByTestId("ticket-sent")).toBeVisible();
    // The button also shows its key (F9).
    await expect(page.getByTestId("pay-order")).toContainText(`Pay ${tsh(firstOrder.remainingMinor)}`);
  });

  await test.step("7. Part payment in cash, the rest by mobile money", async () => {
    const order = firstOrder!;
    await tap(page.getByTestId("pay-order"));
    await expect(page.getByTestId("settle-dialog")).toBeVisible();
    await expect(page.getByTestId("amount-due")).toHaveText(tsh(order.totalMinor));
    // About half, in whole thousands: the guest pays part in cash.
    cashPartMinor = Math.floor(order.totalMinor / 2 / THOUSAND_TSH) * THOUSAND_TSH;
    expect(cashPartMinor).toBeGreaterThan(0);
    await page.getByTestId("amount-received").fill(typed(cashPartMinor));
    await expect(page.getByTestId("change-due")).toHaveText(
      `Part payment: ${tsh(cashPartMinor)} now, ${tsh(order.totalMinor - cashPartMinor)} still to pay`,
    );
    let paid = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${order.id}/payments$`));
    await tap(page.getByTestId("confirm-settle"));
    const cash = await body<Tender>(paid, 201);
    expect(cash.orderClosed).toBe(false);
    expect(cash.paidMinor).toBe(cashPartMinor);
    expect(cash.remainingMinor).toBe(order.totalMinor - cashPartMinor);
    await expect(page.getByTestId("tender-recorded")).toHaveText(`Recorded ${tsh(cashPartMinor)}. ${tsh(cash.remainingMinor)} still to pay.`);
    await expect(page.getByTestId("amount-due")).toHaveText(tsh(cash.remainingMinor));
    await expect(page.getByTestId("amount-paid")).toHaveText(`Paid ${tsh(cash.paidMinor)} of ${tsh(order.totalMinor)}`);

    await tap(page.getByTestId("method-MOBILE_MONEY"));
    await page.getByTestId("tender-reference").fill("MPESA-E2E-0001");
    await expect(page.getByTestId("confirm-settle")).toHaveText(`Confirm ${tsh(cash.remainingMinor)} received`);
    paid = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${order.id}/payments$`));
    await tap(page.getByTestId("confirm-settle"));
    const mobile = await body<Tender>(paid, 201);
    expect(mobile.orderClosed).toBe(true);
    expect(mobile.remainingMinor).toBe(0);
    expect(mobile.paidMinor).toBe(order.totalMinor);

    const done = page.getByTestId("payment-done");
    await expect(done).toBeVisible();
    await expect(page.getByTestId("payment-done-dialog")).toContainText("Paid");
    await expect(done).toContainText(tsh(order.totalMinor));
    await expect(done).toContainText(`Split payment · Order ${order.orderNumber}`);
    // The last tender was mobile money: no change to give.
    await expect(page.getByTestId("done-change")).toHaveCount(0);
    await tap(done.getByRole("button", { name: "New sale" }));
    await expect(done).toHaveCount(0);
  });

  await test.step("7b. A cash sale that gives change", async () => {
    const added = nextApi(page, "POST", /^\/api\/v1\/pos\/orders\/[^/]+\/items$/);
    await tap(page.getByTestId(`menu-${plainDish.name}`));
    const order = await body<Order>(added);
    await tap(page.getByTestId("pay-order"));
    await expect(page.getByTestId("amount-due")).toHaveText(tsh(order.totalMinor));
    // The guest hands over the next ten thousand above the bill.
    const receivedMinor = (Math.floor(order.totalMinor / (10 * THOUSAND_TSH)) + 1) * 10 * THOUSAND_TSH;
    await page.getByTestId("amount-received").fill(typed(receivedMinor));
    await expect(page.getByTestId("change-due")).toHaveText(`Change to give ${tsh(receivedMinor - order.totalMinor)}`);
    const paid = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${order.id}/payments$`));
    await tap(page.getByTestId("confirm-settle"));
    const cash = await body<Tender>(paid, 201);
    expect(cash.orderClosed).toBe(true);
    expect(cash.paidMinor).toBe(order.totalMinor); // Yetu records what was owed, never the note handed over
    const done = page.getByTestId("payment-done");
    await expect(done).toContainText(`Cash · Order ${order.orderNumber}`);
    await expect(page.getByTestId("done-change")).toHaveText(`Change to give ${tsh(receivedMinor - order.totalMinor)}`);
    await tap(done.getByRole("button", { name: "New sale" }));
    secondOrder = order;
  });

  await test.step("8. Cash out, approved by a different supervisor", async () => {
    const cashier = staff.find((person) => person.id === seeded.cashierStaffId)!;
    const manager = staff.find((person) => person.id === seeded.managerStaffId)!;
    await tap(page.getByTestId("nav-manager"));
    await expect(page.getByTestId("cash-summary")).toContainText(tsh(OPENING_FLOAT_MINOR));
    await tap(page.getByTestId("open-cash-out"));
    const dialog = page.getByTestId("cash-movement-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("movement-amount").fill(typed(CASH_OUT_MINOR));
    await page.getByTestId("movement-reason").fill("Gas delivery");
    // The cashier can't approve their own cash out.
    await expect(dialog.getByRole("radio", { name: new RegExp(cashier.displayName) })).toBeDisabled();
    await expect(page.getByTestId("confirm-movement")).toBeDisabled();
    await tap(dialog.getByRole("radio", { name: new RegExp(manager.displayName) }));
    await pin("movement-pin-key", seeded.managerPin);
    const recorded = nextApi(page, "POST", /^\/api\/v1\/pos\/cash-movements$/);
    const refetched = nextApi(page, "GET", /^\/api\/v1\/pos\/shifts\/(current|[0-9a-f-]{36})$/);
    await tap(page.getByTestId("confirm-movement"));
    const movement = await body<{ movementType: string; amountMinor: number }>(recorded, 201);
    expect(movement).toMatchObject({ movementType: "CASH_OUT", amountMinor: CASH_OUT_MINOR });
    shift = await body<Shift>(refetched);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("cash-movement-list")).toContainText("Gas delivery");
    await expect(page.getByTestId("cash-movement-list")).toContainText(tsh(CASH_OUT_MINOR));
  });

  await test.step("9. Close the shift: blind count, check, a manager approves the shortfall", async () => {
    const manager = staff.find((person) => person.id === seeded.managerStaffId)!;
    const expected = shift!.expectedCashMinor;
    // Yetu's figure is its own: the float, the cash part, the cash sale, less the cash out.
    expect(expected).toBe(OPENING_FLOAT_MINOR + cashPartMinor + secondOrder!.totalMinor - CASH_OUT_MINOR);
    const counted = expected - SHORTFALL_MINOR;

    await tap(page.getByTestId("open-close-shift"));
    await expect(page.getByTestId("close-step-count")).toBeVisible();
    // Blind: nothing on the count step shows what Yetu expects.
    await expect(page.getByTestId("close-expected")).toHaveCount(0);
    await expect(page.getByRole("dialog")).not.toContainText(tsh(expected));
    await page.getByTestId("counted-cash").fill(typed(counted));
    await tap(page.getByRole("button", { name: "Check the count" }));

    await expect(page.getByTestId("close-step-check")).toBeVisible();
    await expect(page.getByTestId("close-expected")).toHaveText(tsh(expected));
    await expect(page.getByTestId("close-counted")).toHaveText(tsh(counted));
    await expect(page.getByTestId("close-outcome")).toHaveText("Short. You counted less than Yetu expects.");
    await expect(page.getByTestId("close-shift")).toBeDisabled();
    await tap(page.getByRole("dialog").getByRole("radio", { name: new RegExp(manager.displayName) }));
    await pin("close-pin-key", seeded.managerPin);
    await expect(page.getByTestId("close-shift")).toBeEnabled();
    const closing = nextApi(page, "POST", new RegExp(`^/api/v1/pos/shifts/${shift!.id}/close$`));
    await tap(page.getByTestId("close-shift"));
    const closed = await body<Shift>(closing, 200);
    expect(closed.status).toBe("CLOSED");
    expect(closed.countedCashMinor).toBe(counted);
    expect(closed.expectedCashMinor).toBe(expected);
    expect(closed.varianceMinor).toBe(counted - expected);

    // Done: back to Open shift, with the result Yetu sent back.
    await expect(page.getByTestId("shell-state")).toHaveText("NO_SHIFT");
    const summary = page.getByTestId("closed-shift-summary");
    await expect(summary).toContainText(tsh(expected));
    await expect(summary).toContainText(tsh(counted));
    await expect(summary).toContainText(`Short by ${tsh(SHORTFALL_MINOR)}`);
  });

  await testInfo.attach("api-calls.txt", { body: calls.join("\n"), contentType: "text/plain" });
  await testInfo.attach("console-errors.txt", { body: consoleErrors.join("\n") || "none", contentType: "text/plain" });
  await testInfo.attach("page-errors.txt", { body: pageErrors.join("\n") || "none", contentType: "text/plain" });
  connection.push(`at the end: ${await page.getByTestId("conn-label").textContent({ timeout: 1_000 }).catch(() => "not on screen (Open shift has no top bar)")}`);
  await testInfo.attach("connection-pill.txt", { body: connection.join("\n"), contentType: "text/plain" });
  await testInfo.attach("idle-countdown-taps.txt", { body: String(swallowed()), contentType: "text/plain" });
  expect(swallowed(), "taps the idle-lock countdown took instead of the button pressed").toBe(0);
  expect(pageErrors, "uncaught errors in the till").toEqual([]);
});
