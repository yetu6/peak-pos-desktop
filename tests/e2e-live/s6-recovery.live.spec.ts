/**
 * S6 on the redesigned till, in Chromium, against a live Yetu API: the
 * realtime connection, a payment whose answer was lost (the API stopped
 * while the payment was with it, and started again), and refusals in words.
 * Nothing is mocked: the API process is really stopped and started
 * (liveControl.ts), and what Yetu recorded is read from its database.
 *
 * Run on a freshly seeded restaurant (till.live.spec.ts's header), with the
 * API started by live-api.sh api and its binary built (liveControl restarts
 * it with E2E_SKIP_BUILD=1). The API's outbox worker isn't running, so no
 * live update reaches the till here: realtime is checked as the connection
 * itself (one socket, no reconnects), not as news delivered.
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { WebSession, ensurePlainDish, loadSeededProperty, tsh, typed, chooseApprovers, SEEDED_MANAGER_ROLE } from "./liveApi";
import { paymentRows, startLiveApi, stopLiveApi } from "./liveControl";
import { BRIDGE_PORT, LIVE_API_URL } from "./liveSettings";
import { body, nextApi, openShift, pairTill, setServerAddress, signInWithPin, tapper } from "./liveTill";
import { PAY_CHECK_EVERY_SECONDS } from "../../src/register/registerSettings";

interface Order {
  id: string;
  orderNumber: string;
  /** S5b: the order's number for the day, what the till shows ("Order 42"). */
  dailyNumber: number;
  status: string;
  totalMinor: number;
  version: number;
}

/** Every payment the till asks Yetu to record, with the key it used. */
function paymentRequests(page: Page) {
  const sent: Array<{ orderId: string; key: string; body: string }> = [];
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    const match = /^\/api\/v1\/pos\/orders\/([^/]+)\/payments$/.exec(url.pathname);
    if (!request.url().startsWith(LIVE_API_URL) || request.method() !== "POST" || !match) return;
    sent.push({ orderId: match[1], key: request.headers()["idempotency-key"] ?? "", body: request.postData() ?? "" });
  });
  return sent;
}

/** The realtime sockets the page opens to the dev bridge, and how many closed. */
function sockets(page: Page) {
  const seen = { opened: 0, closed: 0 };
  page.on("websocket", (socket) => {
    if (!socket.url().includes(`:${BRIDGE_PORT}/`)) return;
    seen.opened += 1;
    socket.on("close", () => (seen.closed += 1));
  });
  return seen;
}

test("S6: one realtime connection, lost payment answers resolved by Yetu, refusals in words", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const seeded = loadSeededProperty();
  const web = new WebSession();
  await web.signIn(seeded.ownerEmail);
  const plainDish = await ensurePlainDish(web, seeded);
  // Since fbc-peak #258 a new business has nobody chosen to approve at the till: the owner chooses, here for the
  // seeded manager's role, every kind.
  const approves = await chooseApprovers(web, seeded, SEEDED_MANAGER_ROLE);
  expect(approves, "the manager's role may approve every kind").toEqual(expect.arrayContaining(["VOID", "DISCOUNT", "CASH_OUT", "SHIFT_VARIANCE"]));
  const { tap, pin, swallowed } = tapper(page);
  const realtime = sockets(page);
  const payments = paymentRequests(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  let staff: Array<{ id: string; displayName: string }> = [];

  await test.step("1. Signed in with the shift open: one realtime connection, kept across every section", async () => {
    await setServerAddress(page);
    const { roster } = await pairTill(page, web, seeded, { terminalName: `S6 till ${crypto.randomUUID().slice(0, 6)}` });
    const signedIn = await signInWithPin(page, roster, seeded.cashierStaffId, seeded.cashierPin, pin);
    staff = signedIn.staff;
    await body(signedIn.catalogResponse);
    await openShift(page, 5_000_000, tap);
    for (const section of ["orders", "kitchen", "manager", "status", "new", "orders", "new"]) {
      await tap(page.getByTestId(`nav-${section}`));
      await page.waitForTimeout(400);
    }
    await expect.poll(() => realtime.opened).toBe(1);
    expect(realtime.closed, "no reconnect while signed in").toBe(0);
  });

  /** A new sale of one plain dish on Sell, then Pay with the exact cash typed. */
  async function saleAtPay(): Promise<Order> {
    await tap(page.getByTestId("nav-new"));
    const added = nextApi(page, "POST", /^\/api\/v1\/pos\/orders\/[^/]+\/items$/);
    await tap(page.getByTestId(`menu-${plainDish.name}`));
    const order = await body<Order>(added);
    await tap(page.getByTestId("pay-order"));
    await expect(page.getByTestId("amount-due")).toHaveText(tsh(order.totalMinor));
    await page.getByTestId("amount-received").fill(typed(order.totalMinor + 1_000_000));
    return order;
  }

  async function paidOnce(order: Order) {
    const done = page.getByTestId("payment-done");
    await expect(done).toBeVisible({ timeout: (PAY_CHECK_EVERY_SECONDS + 20) * 1000 });
    await expect(done).toContainText(`Cash · Order ${order.dailyNumber}`);
    await expect(page.getByTestId("done-change")).toHaveText(`Change to give ${tsh(1_000_000)}`);
    const mine = payments.filter((entry) => entry.orderId === order.id);
    expect(mine.length, "the payment was asked for more than once").toBeGreaterThan(1);
    expect(new Set(mine.map((entry) => entry.key)).size, "one idempotency key for the one payment").toBe(1);
    expect(new Set(mine.map((entry) => entry.body)).size, "the same request each time").toBe(1);
    expect(paymentRows(order.id), "pos_payments rows Yetu holds for the order").toBe(1);
    await tap(done.getByRole("button", { name: "New sale" }));
    await expect(done).toHaveCount(0);
  }

  await test.step("2. After Yetu recorded it, the answer is lost and Yetu stops: the till never guesses", async () => {
    const order = await saleAtPay();
    // Yetu records the payment; then it stops before its answer reaches the till.
    await page.route(
      new RegExp(`^${LIVE_API_URL}/api/v1/pos/orders/${order.id}/payments$`),
      async (route) => {
        const answer = await route.fetch();
        expect(answer.status()).toBe(201);
        await stopLiveApi();
        await route.abort("connectionreset");
      },
      { times: 1 },
    );
    await tap(page.getByTestId("confirm-settle"));
    const unsure = page.getByTestId("pay-unsure");
    await expect(unsure).toContainText("The connection dropped while Yetu was recording this payment. We don't know yet if it went through.");
    await expect(unsure).toContainText("Still can't reach Yetu. Don't take the money again until Yetu answers.", { timeout: 30_000 });
    await expect(page.getByTestId("confirm-settle")).toHaveCount(0);
    expect(paymentRows(order.id), "Yetu recorded it before it stopped").toBe(1);
    await startLiveApi();
    // The same request again: Yetu replays its answer, and the till shows the payment done once.
    await paidOnce(order);
  });

  await test.step("3. Before Yetu got it (Yetu stopped first): recorded once when Yetu is back", async () => {
    const order = await saleAtPay();
    await stopLiveApi();
    await tap(page.getByTestId("confirm-settle"));
    await expect(page.getByTestId("pay-unsure")).toContainText("Still can't reach Yetu.", { timeout: 30_000 });
    expect(paymentRows(order.id), "nothing recorded while Yetu was down").toBe(0);
    await startLiveApi();
    await paidOnce(order);
  });

  await test.step("4. While it was on the way (Yetu stops with the request in flight): recorded once", async () => {
    const order = await saleAtPay();
    await page.route(
      new RegExp(`^${LIVE_API_URL}/api/v1/pos/orders/${order.id}/payments$`),
      async (route) => {
        await stopLiveApi();
        await route.continue();
      },
      { times: 1 },
    );
    await tap(page.getByTestId("confirm-settle"));
    await expect(page.getByTestId("pay-unsure")).toBeVisible();
    await startLiveApi();
    await paidOnce(order);
  });

  await test.step("5. Status and Sync in the browser: checks in words, no print path, the live connection", async () => {
    await tap(page.getByTestId("nav-status"));
    await expect(page.getByTestId("diag-check-yetu")).toContainText("Yetu answers.");
    await expect(page.getByTestId("diag-check-live")).toContainText("On. New orders and changes show at once.");
    await expect(page.getByTestId("diag-check-receipt-printer")).toContainText("Printing works only in the till app on the counter computer.");
    await expect(page.getByRole("button", { name: "Print test page" })).toHaveCount(0);
    await tap(page.getByTestId("connectivity"));
    const sync = page.getByRole("dialog", { name: "Sync" });
    await expect(sync).toContainText("Sales go to Yetu as they happen. Nothing is kept on this till for later.");
    await tap(sync.getByRole("button", { name: "Close" }).first());
    await expect(sync).toHaveCount(0);
  });

  /** An open sale of one plain dish, with the void sheet open on it. */
  async function voidSheet(): Promise<Order> {
    await tap(page.getByTestId("nav-new"));
    const added = nextApi(page, "POST", /^\/api\/v1\/pos\/orders\/[^/]+\/items$/);
    await tap(page.getByTestId(`menu-${plainDish.name}`));
    const order = await body<Order>(added);
    await tap(page.getByRole("button", { name: "More" }));
    await tap(page.getByRole("button", { name: /Void the order/ }));
    const sheet = page.getByTestId("void-order-dialog");
    await sheet.getByTestId("void-reason").fill("Guest left before ordering");
    const manager = staff.find((person) => person.id === seeded.managerStaffId)!;
    await tap(sheet.getByRole("radio", { name: new RegExp(manager.displayName) }));
    return order;
  }

  await test.step("6. A supervisor PIN that doesn't match: Yetu's 403 in words, never a code", async () => {
    await voidSheet();
    const sheet = page.getByTestId("void-order-dialog");
    // The manager's PIN with every digit moved on by one: six digits, and not theirs.
    const wrong = seeded.managerPin.split("").map((digit) => String((Number(digit) + 1) % 10)).join("");
    await pin("void-pin-key", wrong);
    const refused = nextApi(page, "POST", /^\/api\/v1\/pos\/orders\/[^/]+\/void$/);
    await tap(sheet.getByTestId("confirm-void-order"));
    const answer = await refused;
    expect(answer.status()).toBe(403);
    expect((await answer.json()).code).toBe("FORBIDDEN");
    await expect(sheet.getByRole("alert")).toHaveText(
      "A different supervisor must approve the void. Their PIN wasn't accepted, or they can't approve voids.",
    );
    await expect(sheet).not.toContainText(/403|FORBIDDEN|permission denied/i);
    await tap(sheet.getByRole("button", { name: "Cancel" }));
  });

  await testInfo.attach("payment-requests.json", { body: JSON.stringify(payments, null, 2), contentType: "application/json" });
  expect(swallowed(), "taps the idle-lock countdown took").toBe(0);
  expect(pageErrors, "uncaught errors in the till").toEqual([]);
});
