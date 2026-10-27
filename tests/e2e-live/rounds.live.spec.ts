/**
 * Rounds (S17a) on the till, in Chromium, against a live Yetu API: the real
 * app, the real fbc-peak routes (addItem after a send, sendPOSOrder as the
 * next round, recordPOSManualTender's UNSENT_LINES), a real database.
 * Nothing is mocked and no money figure is written here: every amount
 * checked is the one Yetu returned.
 *
 * Steps: pair, sign in, open a shift -> sell the plain dish and send it
 * (round 1) -> add another after it was sent: the menu still takes it, the
 * send button says Round 2 and Pay waits, in Yetu's words -> send round 2:
 * each line says its round -> pay: the order closes with both rounds.
 *
 * Run as the other live suites (tests/e2e-live/live-api.sh api and worker),
 * on a freshly seeded restaurant, with FBC_PEAK_DIR at a checkout with rounds.
 */
import { expect, test, type Response } from "@playwright/test";
import { WebSession, ensurePlainDish, loadSeededProperty, typed } from "./liveApi";
import { LIVE_API_URL } from "./liveSettings";
import { body, nextApi, openShift, pairTill, payAfterPapers, printShownPapers, setServerAddress, signInWithPin, tapper } from "./liveTill";

const OPENING_FLOAT_MINOR = 5_000_000;

interface Order {
  id: string;
  status: string;
  roundsSent: number;
  totalMinor: number;
  items: Array<{ id: string; status: string; roundNumber?: number }>;
}

test("rounds on the till, against the live API", async ({ page }, testInfo) => {
  const seeded = loadSeededProperty();
  const web = new WebSession();
  await web.signIn(seeded.ownerEmail);
  const dish = await ensurePlainDish(web, seeded);
  const { tap, pin } = tapper(page);
  const calls: string[] = [];
  const pageErrors: string[] = [];
  page.on("response", (response: Response) => {
    if (response.url().startsWith(LIVE_API_URL)) {
      const url = new URL(response.url());
      calls.push(`${response.request().method()} ${url.pathname}${url.search} -> ${response.status()}`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await test.step("1. Pair, sign in, open the shift", async () => {
    await setServerAddress(page);
    const { roster } = await pairTill(page, web, seeded, { terminalName: `Rounds till ${crypto.randomUUID().slice(0, 6)}` });
    const signedIn = await signInWithPin(page, roster, seeded.cashierStaffId, seeded.cashierPin, pin);
    await body(signedIn.catalogResponse);
    await openShift(page, OPENING_FLOAT_MINOR, tap);
  });

  let order: Order | null = null;
  await test.step("2. Round 1: the dish, sent", async () => {
    await tap(page.getByTestId("nav-new"));
    const created = nextApi(page, "POST", /^\/api\/v1\/pos\/orders$/);
    const added = nextApi(page, "POST", /^\/api\/v1\/pos\/orders\/[^/]+\/items$/);
    await tap(page.getByTestId(`menu-${dish.name}`));
    await body<Order>(created, 201);
    await body<Order>(added);
    const read = nextApi(page, "GET", /^\/api\/v1\/pos\/orders\/[0-9a-f-]{36}$/);
    await tap(page.getByTestId("send-order"));
    await printShownPapers(page, tap);
    order = await body<Order>(read);
    expect(order.roundsSent).toBe(1);
  });

  await test.step("3. Another after it was sent: Round 2 to print, and Pay prints it first", async () => {
    const added = nextApi(page, "POST", /^\/api\/v1\/pos\/orders\/[^/]+\/items$/);
    await tap(page.getByTestId(`menu-${dish.name}`));
    order = await body<Order>(added);
    expect(order.items.filter((line) => line.status === "ADDED")).toHaveLength(1);
    await expect(page.getByTestId("send-order")).toHaveText(/Print (order|for )/);
    // A cashier can print what is new, so Pay does it first and says so; Pay waits only for someone who can't (pay-waits).
    await expect(page.getByTestId("pay-order")).toBeEnabled();
    await expect(page.getByTestId("pay-prints-first")).toHaveText("New items print for the kitchen first.");
  });

  await test.step("4. Round 2 sent: each line says its round; then paid in full", async () => {
    const read = nextApi(page, "GET", /^\/api\/v1\/pos\/orders\/[0-9a-f-]{36}$/);
    await tap(page.getByTestId("send-order"));
    await printShownPapers(page, tap);
    order = await body<Order>(read);
    expect(order.roundsSent).toBe(2);
    expect(order.items.map((line) => line.roundNumber).sort()).toEqual([1, 2]);
    const ticket = page.getByTestId("ticket-panel");
    await expect(ticket.getByText("Round 1")).toBeVisible();
    await expect(ticket.getByText("Round 2")).toBeVisible();
    await payAfterPapers(page, tap, page.getByTestId("pay-order"));
    await page.getByTestId("amount-received").fill(typed(order.totalMinor));
    const paid = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${order.id}/payments$`));
    await tap(page.getByTestId("confirm-settle"));
    expect((await body<{ orderClosed: boolean }>(paid, 201)).orderClosed).toBe(true);
  });

  await testInfo.attach("api-calls.txt", { body: calls.join("\n"), contentType: "text/plain" });
  expect(pageErrors, "uncaught errors in the till").toEqual([]);
});
