/**
 * Refunds by item (S7) on the till, in Chromium, against a live Yetu API:
 * the real app, the real fbc-peak routes (quotePOSRefund, recordPOSRefund,
 * listPOSOrderRefunds), a real database. Nothing is mocked and no money
 * figure is written here: every amount checked is the one Yetu returned.
 *
 * Steps: pair, sign in, open a shift -> sell two of the plain dish (two
 * lines of one) and take exact cash -> Orders, Paid today -> Refund items:
 * one dish back in cash, a different supervisor's PIN -> the order reads
 * Partly refunded and the drawer expects that much less -> refund the other
 * dish: Yetu gives back exactly what is left, the order reads Refunded and
 * nothing more is offered.
 *
 * Printing: in a browser every print job is claimed and reported to Yetu as
 * failed ("No printer is configured"); the refund slip is one of them, and
 * the done screen says so while the refund stands.
 *
 * Run as the other live suites (tests/e2e-live/live-api.sh), on a freshly
 * seeded restaurant.
 */
import { expect, test, type Response } from "@playwright/test";
import { WebSession, ensurePlainDish, loadSeededProperty, tsh, typed, chooseApprovers, SEEDED_MANAGER_ROLE } from "./liveApi";
import { LIVE_API_URL } from "./liveSettings";
import { body, nextApi, openShift, pairTill, payAfterPapers, setServerAddress, signInWithPin, tapper, type Shift } from "./liveTill";

/** The cash the cashier counts into the drawer when the shift opens. */
const OPENING_FLOAT_MINOR = 5_000_000;

interface Order {
  id: string;
  dailyNumber: number;
  status: string;
  totalMinor: number;
  items: Array<{ id: string; name: string; quantity: number }>;
}
interface Quote {
  totalMinor: number;
  cashMinor: number;
  lines: Array<{ orderItemId: string; quantity: number; totalMinor: number }>;
  tenders: Array<{ paymentId: string; paymentMethod: string; amountMinor: number }>;
}
interface Refund {
  id: string;
  totalMinor: number;
  reason: string;
  authorizedById: string;
  lines: Array<{ orderItemId: string; quantity: number }>;
  tenders: Array<{ paymentMethod: string; amountMinor: number }>;
  receiptJobId?: string;
}
interface OrderRefunds {
  totalMinor: number;
  refundedMinor: number;
  remainingMinor: number;
  lines: Array<{ orderItemId: string; remainingQuantity: number }>;
}

test("refunds by item on the till, against the live API", async ({ page }, testInfo) => {
  const seeded = loadSeededProperty();
  const web = new WebSession();
  await web.signIn(seeded.ownerEmail);
  const plainDish = await ensurePlainDish(web, seeded);
  const approves = await chooseApprovers(web, seeded, SEEDED_MANAGER_ROLE);
  expect(approves, "the manager's role may approve refunds").toContain("REFUND");

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

  let staff: Array<{ id: string; displayName: string }> = [];
  let shift: Shift | null = null;
  let order: Order | null = null;
  let first: Refund | null = null;

  await test.step("1. Pair, sign in, open the shift", async () => {
    await setServerAddress(page);
    const { roster } = await pairTill(page, web, seeded, { terminalName: `Refund till ${crypto.randomUUID().slice(0, 6)}` });
    const signedIn = await signInWithPin(page, roster, seeded.cashierStaffId, seeded.cashierPin, pin);
    staff = signedIn.staff;
    await body(signedIn.catalogResponse);
    shift = await openShift(page, OPENING_FLOAT_MINOR, tap);
  });

  await test.step("2. Sell two of the dish, paid in exact cash", async () => {
    await tap(page.getByTestId("nav-new"));
    const created = nextApi(page, "POST", /^\/api\/v1\/pos\/orders$/);
    let added = nextApi(page, "POST", /^\/api\/v1\/pos\/orders\/[^/]+\/items$/);
    await tap(page.getByTestId(`menu-${plainDish.name}`));
    await body<Order>(created, 201);
    await body<Order>(added);
    added = nextApi(page, "POST", /^\/api\/v1\/pos\/orders\/[^/]+\/items$/);
    await tap(page.getByTestId(`menu-${plainDish.name}`));
    order = await body<Order>(added);
    expect(order.items.reduce((sum, line) => sum + line.quantity, 0)).toBe(2);
    await payAfterPapers(page, tap, page.getByTestId("pay-order"));
    await page.getByTestId("amount-received").fill(typed(order.totalMinor));
    const paid = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${order.id}/payments$`));
    await tap(page.getByTestId("confirm-settle"));
    expect((await body<{ orderClosed: boolean }>(paid, 201)).orderClosed).toBe(true);
    await tap(page.getByTestId("payment-done").getByRole("button", { name: "New sale" }));
  });

  await test.step("3. Refund one dish in cash, approved by a different supervisor", async () => {
    const sold = order!;
    const cashier = staff.find((person) => person.id === seeded.cashierStaffId)!;
    const manager = staff.find((person) => person.id === seeded.managerStaffId)!;
    await tap(page.getByTestId("nav-orders"));
    await tap(page.getByRole("tab", { name: /Paid today/ }));
    const refundsRead = nextApi(page, "GET", new RegExp(`^/api/v1/pos/orders/${sold.id}/refunds$`));
    await tap(page.getByTestId(`order-row-${sold.id}`));
    const before = await body<OrderRefunds>(refundsRead);
    expect(before.refundedMinor).toBe(0);
    const detail = page.getByRole("dialog", { name: `Order ${sold.dailyNumber}` });
    await expect(detail.getByTestId("order-detail-status")).toHaveText("Paid");
    await tap(detail.getByTestId("detail-refund"));

    const sheet = page.getByTestId("refund-items");
    await expect(sheet).toBeVisible();
    const lineId = before.lines[0].orderItemId;
    const quoted = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${sold.id}/refunds/quote$`));
    await tap(sheet.getByTestId(`refund-line-${lineId}`).getByRole("button", { name: new RegExp(`One more ${plainDish.name}`) }));
    const quote = await body<Quote>(quoted);
    expect(quote.lines).toEqual([expect.objectContaining({ orderItemId: lineId, quantity: 1 })]);
    await tap(sheet.getByTestId("refund-reason-0"));
    await expect(sheet.getByTestId("refund-summary")).toHaveText(`Give back ${tsh(quote.totalMinor)} in cash`);

    await tap(page.getByTestId("refund-ask"));
    // Only the people the owner chose to approve refunds are offered: the cashier is not one, so can't approve their own.
    await expect(sheet.getByRole("radio", { name: new RegExp(manager.displayName) })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: new RegExp(cashier.displayName) })).toHaveCount(0);
    await tap(sheet.getByRole("radio", { name: new RegExp(manager.displayName) }));
    await pin("refund-pin-key", seeded.managerPin);
    await expect(page.getByTestId("refund-give")).toHaveText(`Give back ${tsh(quote.totalMinor)}`);
    const recorded = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${sold.id}/refunds$`));
    const shiftAfter = nextApi(page, "GET", /^\/api\/v1\/pos\/shifts\/(current|[0-9a-f-]{36})$/);
    await tap(page.getByTestId("refund-give"));
    first = await body<Refund>(recorded, 201);
    expect(first.totalMinor).toBe(quote.totalMinor);
    expect(first.authorizedById).toBe(seeded.managerStaffId);
    expect(first.lines).toEqual([expect.objectContaining({ orderItemId: lineId, quantity: 1 })]);
    expect(first.tenders).toEqual([expect.objectContaining({ paymentMethod: "CASH", amountMinor: quote.totalMinor })]);

    const done = page.getByTestId("refund-done-view");
    await expect(done).toContainText(`Refunded ${tsh(first.totalMinor)}`);
    await expect(done).toContainText(`Give ${tsh(first.totalMinor)} back in cash from the drawer.`);
    await expect(page.getByTestId("refund-print")).toHaveText("The refund slip didn't print (No printer is configured). The refund is recorded.");

    // The drawer expects the refund less: Yetu's figure, as the till reads it.
    shift = await body<Shift>(shiftAfter);
    expect(shift.expectedCashMinor).toBe(OPENING_FLOAT_MINOR + sold.totalMinor - first.totalMinor);

    await tap(page.getByTestId("refund-done"));
    await expect(detail.getByTestId("order-detail-status")).toHaveText("Partly refunded");
    await expect(detail.getByTestId("order-detail-refunds")).toContainText(`${tsh(first.totalMinor)} back in cash`);
  });

  await test.step("4. Refund the other dish: exactly what is left, then nothing more is offered", async () => {
    const sold = order!;
    const manager = staff.find((person) => person.id === seeded.managerStaffId)!;
    const detail = page.getByRole("dialog", { name: `Order ${sold.dailyNumber}` });
    await tap(detail.getByTestId("detail-refund"));
    const sheet = page.getByTestId("refund-items");
    // Each tap on the menu made a line of one: the first is refunded, the other is left.
    const given = first!.lines[0].orderItemId;
    await expect(sheet.getByTestId(`refund-line-${given}`)).toContainText("Refunded");
    await expect(sheet.getByTestId(`refund-line-${given}`).getByRole("button")).toHaveCount(0);
    const lineId = sold.items.find((line) => line.id !== given)!.id;
    await expect(sheet.getByTestId(`refund-line-${lineId}`)).toContainText("1 sold");
    const quoted = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${sold.id}/refunds/quote$`));
    await tap(sheet.getByTestId(`refund-line-${lineId}`).getByRole("button", { name: new RegExp(`One more ${plainDish.name}`) }));
    const quote = await body<Quote>(quoted);
    // The last refund of a line takes exactly what remains: no shilling left or invented.
    expect(quote.totalMinor).toBe(sold.totalMinor - first!.totalMinor);
    await tap(sheet.getByTestId("refund-reason-other"));
    await sheet.getByTestId("refund-reason-text").fill("Guest left before it came");
    await tap(page.getByTestId("refund-ask"));
    await tap(sheet.getByRole("radio", { name: new RegExp(manager.displayName) }));
    await pin("refund-pin-key", seeded.managerPin);
    const recorded = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${sold.id}/refunds$`));
    await tap(page.getByTestId("refund-give"));
    const second = await body<Refund>(recorded, 201);
    expect(second.reason).toBe("Guest left before it came");
    const refundsRead = nextApi(page, "GET", new RegExp(`^/api/v1/pos/orders/${sold.id}/refunds$`));
    await tap(page.getByTestId("refund-done"));
    const after = await body<OrderRefunds>(refundsRead);
    expect(after.refundedMinor).toBe(sold.totalMinor);
    expect(after.remainingMinor).toBe(0);
    await expect(detail.getByTestId("order-detail-status")).toHaveText("Refunded");
    await expect(detail.getByTestId("detail-refund")).toBeDisabled();
    await expect(detail.getByText("Everything on this order has been refunded.")).toBeVisible();
  });

  await testInfo.attach("api-calls.txt", { body: calls.join("\n"), contentType: "text/plain" });
  expect(pageErrors, "uncaught errors in the till").toEqual([]);
});
