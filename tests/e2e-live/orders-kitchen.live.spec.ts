/**
 * Orders and the kitchen on the redesigned till, in Chromium, against a live
 * Yetu API: the real app from Vite's dev server, the real fbc-peak routes, a
 * real database. Nothing is mocked and no money figure is written into this
 * file: every amount, status, version and time checked on screen is the one
 * the API returned to the till (read from the till's own responses).
 *
 * Steps: a selling till is paired, signed in and its shift opened (the same
 * way as till.live.spec.ts) -> order A is sold and sent -> the till's own
 * Kitchen moves it Start, Ready, Served (whole-order steps, one key each) ->
 * Orders shows it served, with its sent time -> it is paid from its detail ->
 * Paid this shift lists it and prints a copy of its receipt -> order B is sent
 * and a kitchen display, paired as one, moves its station ticket through the
 * same steps -> Orders shows order B served by the kitchen.
 *
 * The same stand-ins as till.live.spec.ts: a browser key store, printing
 * claimed and reported as failed ("No printer is configured"), realtime
 * through the dev bridge. Run it on a freshly seeded restaurant (see that
 * file's header); it pairs two tills of its own.
 */
import { expect, test, type Page, type Response } from "@playwright/test";
import { WebSession, ensurePlainDish, loadSeededProperty, tsh, typed } from "./liveApi";
import { LIVE_API_URL } from "./liveSettings";
import { ORDERS_REFRESH_SECONDS } from "../../src/orders/ordersSettings";
import { body, nextApi, openShift, pairTill, setServerAddress, signInWithPin, tapper } from "./liveTill";

/** The cash counted into the selling till's drawer. */
const OPENING_FLOAT_MINOR = 5_000_000;

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  totalMinor: number;
  version: number;
  items: Array<{ name: string }>;
}
interface StationTicket {
  id: string;
  orderId: string;
  station: string;
  status: string;
  version: number;
  createdAt: string;
}
interface Receipt {
  reprintCount: number;
  document: { orderNumber: string; tenderMethod: string; totalMinor: number };
}

/** A clock time as the till writes it (24-hour, en-GB), written out here on its own. */
function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** Each ask the till makes for a list, kept so a step can read what the till was last told. */
function lastAnswers(page: Page) {
  const orders: Order[][] = [];
  const tickets: StationTicket[][] = [];
  page.on("response", (response) => {
    if (!response.url().startsWith(LIVE_API_URL) || response.request().method() !== "GET" || !response.ok()) return;
    const url = new URL(response.url());
    if (url.pathname === "/api/v1/pos/orders" && url.searchParams.get("active") === "true") {
      void response.json().then((list: Order[]) => orders.push(list), () => undefined);
    } else if (url.pathname === "/api/v1/pos/station-tickets") {
      void response.json().then((list: { items: StationTicket[] }) => tickets.push(list.items), () => undefined);
    }
  });
  return { orders, tickets };
}

function evidence(page: Page) {
  const calls: string[] = [];
  const pageErrors: string[] = [];
  page.on("response", (response: Response) => {
    if (response.url().startsWith(LIVE_API_URL)) {
      const url = new URL(response.url());
      calls.push(`${response.request().method()} ${url.pathname}${url.search} -> ${response.status()}`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  return { calls, pageErrors };
}

test("orders and the kitchen on the redesigned till, against the live API", async ({ page, browser }, testInfo) => {
  const seeded = loadSeededProperty();
  const web = new WebSession();
  await web.signIn(seeded.ownerEmail);
  const plainDish = await ensurePlainDish(web, seeded);
  const { tap, pin, swallowed } = tapper(page);
  const till = evidence(page);
  const told = lastAnswers(page);

  let orderA: Order | null = null;
  let orderB: Order | null = null;

  await test.step("1. A selling till: paired, the cashier signed in, the shift open", async () => {
    await setServerAddress(page);
    const { roster } = await pairTill(page, web, seeded, { terminalName: `Orders till ${crypto.randomUUID().slice(0, 6)}` });
    const signedIn = await signInWithPin(page, roster, seeded.cashierStaffId, seeded.cashierPin, pin);
    await body(signedIn.catalogResponse);
    await openShift(page, OPENING_FLOAT_MINOR, tap);
  });

  /** Sell `count` of the plain dish as a new order and send it; returns the order as Yetu has it once sent. */
  async function sellAndSend(count: number): Promise<Order> {
    await tap(page.getByTestId("nav-new"));
    let order: Order | null = null;
    for (let index = 0; index < count; index++) {
      const added = nextApi(page, "POST", /^\/api\/v1\/pos\/orders\/[^/]+\/items$/);
      await tap(page.getByTestId(`menu-${plainDish.name}`));
      order = await body<Order>(added, 201);
    }
    expect(order!.items).toHaveLength(count);
    const sent = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${order!.id}/send$`));
    const fresh = nextApi(page, "GET", new RegExp(`^/api/v1/pos/orders/${order!.id}$`));
    await tap(page.getByTestId("send-order"));
    expect((await sent).ok()).toBe(true);
    const after = await body<Order>(fresh);
    expect(after.status).toBe("SENT");
    return after;
  }

  await test.step("2. Order A is sold and sent to the kitchen", async () => {
    orderA = await sellAndSend(2);
  });

  await test.step("3. The till's own Kitchen moves order A: Start, Ready, Served, one key each", async () => {
    const order = orderA!;
    await tap(page.getByTestId("nav-kitchen"));
    const card = page.getByTestId(`kitchen-ticket-${order.id}`);
    await expect(page.getByTestId("kitchen-column-SENT").getByTestId(`kitchen-ticket-${order.id}`)).toBeVisible();
    // The time sent is the time Yetu made the order's station ticket.
    await expect.poll(() => told.tickets.at(-1)?.some((ticket) => ticket.orderId === order.id)).toBe(true);
    const ticket = told.tickets.at(-1)!.find((entry) => entry.orderId === order.id)!;
    await expect(card).toContainText(`Sent ${clock(ticket.createdAt)}`);
    await expect(card).toContainText(order.orderNumber);

    let version = order.version;
    const keys: string[] = [];
    const steps = [
      { press: "Start", target: "PREPARING", column: "PREPARING", said: `Order ${order.orderNumber} started.` },
      { press: "Ready", target: "READY", column: "READY", said: `Order ${order.orderNumber} is ready.` },
      { press: "Served", target: "SERVED", column: null, said: `Order ${order.orderNumber} is served.` },
    ];
    for (const step of steps) {
      const moved = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${order.id}/status/${step.target}$`));
      const fresh = nextApi(page, "GET", new RegExp(`^/api/v1/pos/orders/${order.id}$`));
      await expect(page.getByTestId(`kitchen-next-${order.id}`)).toHaveAccessibleName(`${step.press} order ${order.orderNumber}`);
      await tap(page.getByTestId(`kitchen-next-${order.id}`));
      const response = await moved;
      expect(response.status()).toBe(204);
      expect(JSON.parse(response.request().postData() ?? "{}")).toEqual({ version });
      keys.push((await response.request().allHeaders())["idempotency-key"]);
      const after = await body<Order>(fresh);
      expect(after.status).toBe(step.target);
      version = after.version;
      await expect(page.getByTestId("kitchen-result")).toHaveText(step.said);
      if (step.column) await expect(page.getByTestId(`kitchen-column-${step.column}`).getByTestId(`kitchen-ticket-${order.id}`)).toBeVisible();
      else await expect(card).toHaveCount(0);
    }
    expect(new Set(keys).size, "a new key for each step").toBe(3);
    orderA = { ...order, status: "SERVED", version };
  });

  await test.step("4. Orders shows order A served, with when it was sent", async () => {
    const order = orderA!;
    const listed = nextApi(page, "GET", /^\/api\/v1\/pos\/orders$/, (response) => new URL(response.url()).searchParams.get("active") === "true");
    await tap(page.getByTestId("nav-orders"));
    const list = await body<Order[]>(listed);
    expect(list.find((entry) => entry.id === order.id)?.status).toBe("SERVED");
    const row = page.getByTestId(`order-row-${order.id}`);
    await expect(row).toContainText("Served");
    await expect(row).toContainText(tsh(order.totalMinor));
    await tap(row);
    const detail = page.getByRole("dialog", { name: `Order ${order.orderNumber}` });
    await expect(detail.getByTestId("order-detail-status")).toHaveText("Served");
    // The whole order moved, its station ticket didn't: the timeline says the order's own step.
    await expect(detail.getByTestId("order-detail-timeline")).toContainText("Now: Served");
    await expect(detail.getByTestId("order-detail-timeline")).toContainText("Sent to the kitchen");
  });

  await test.step("5. Order A is paid in cash from its detail; payment done goes back to Orders", async () => {
    const order = orderA!;
    const detail = page.getByRole("dialog", { name: `Order ${order.orderNumber}` });
    await expect(detail.getByTestId("detail-pay")).toContainText(`Pay ${tsh(order.totalMinor)}`);
    await tap(detail.getByTestId("detail-pay"));
    await expect(page.getByTestId("amount-due")).toHaveText(tsh(order.totalMinor));
    await page.getByTestId("amount-received").fill(typed(order.totalMinor));
    const paid = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${order.id}/payments$`));
    await tap(page.getByTestId("confirm-settle"));
    const tender = await body<{ orderClosed: boolean; paidMinor: number }>(paid, 201);
    expect(tender.orderClosed).toBe(true);
    expect(tender.paidMinor).toBe(order.totalMinor);
    const done = page.getByTestId("payment-done");
    await expect(done).toContainText(`Cash · Order ${order.orderNumber}`);
    await expect(page.getByTestId("done-countdown")).toContainText("Back to Orders");
    await tap(done.getByRole("button", { name: "Back to orders" }));
    await expect(page.getByTestId(`order-row-${order.id}`)).toHaveCount(0);
  });

  await test.step("6. Paid this shift lists order A; a copy of its receipt is printed", async () => {
    const order = orderA!;
    const all = nextApi(page, "GET", /^\/api\/v1\/pos\/orders$/, (response) => new URL(response.url()).searchParams.get("active") === "false");
    await tap(page.getByRole("tab", { name: /Paid this shift/ }));
    const everything = await body<Order[]>(all);
    expect(everything.find((entry) => entry.id === order.id)?.status).toBe("CLOSED");
    const row = page.getByTestId(`order-row-${order.id}`);
    await expect(row).toContainText("Paid");
    await expect(row).toContainText(tsh(order.totalMinor));

    const kept = nextApi(page, "GET", new RegExp(`^/api/v1/pos/orders/${order.id}/receipt$`));
    await tap(row);
    const receipt = await body<Receipt>(kept);
    expect(receipt.document.tenderMethod).toBe("CASH");
    const detail = page.getByRole("dialog", { name: `Order ${order.orderNumber}` });
    await expect(detail.getByTestId("order-detail-payment")).toContainText("Paid by Cash");

    // Every receipt Yetu sends from here on: the one asked for after the copy counts it.
    const receipts: Receipt[] = [];
    page.on("response", (response) => {
      if (response.request().method() === "GET" && new URL(response.url()).pathname === `/api/v1/pos/orders/${order.id}/receipt`) {
        void response.json().then((sent: Receipt) => receipts.push(sent), () => undefined);
      }
    });
    const reprinted = nextApi(page, "POST", new RegExp(`^/api/v1/pos/orders/${order.id}/receipt/reprint$`));
    await tap(detail.getByTestId("detail-reprint"));
    expect((await reprinted).status()).toBe(201);
    await expect.poll(() => receipts.at(-1)?.reprintCount).toBe(receipt.reprintCount + 1);
    const counted = receipts.at(-1)!;
    await expect(detail.getByTestId("order-detail-result")).toHaveText("A copy of the receipt was sent to the printer.");
    await expect(detail.getByTestId("order-detail-payment")).toContainText(
      `Printed again ${counted.reprintCount} ${counted.reprintCount === 1 ? "time" : "times"}`,
    );
    await tap(detail.getByRole("button", { name: "Close" }).last());
    await expect(detail).toHaveCount(0);
  });

  await test.step("7. Order B is sold and sent; Orders is left open on it", async () => {
    orderB = await sellAndSend(1);
    const order = orderB;
    await tap(page.getByTestId("nav-orders"));
    await expect(page.getByTestId(`order-row-${order.id}`)).toContainText("Sent to kitchen");
    await tap(page.getByTestId(`order-row-${order.id}`));
    await expect(page.getByRole("dialog", { name: `Order ${order.orderNumber}` }).getByTestId("order-detail-status")).toHaveText("Sent to kitchen");
  });

  await test.step("8. A kitchen display moves order B's station ticket: Start, Ready, Served", async () => {
    const order = orderB!;
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 1280, height: 800 } });
    const display = await context.newPage();
    const kds = tapper(display);
    const kdsEvidence = evidence(display);
    const kdsTold = lastAnswers(display);
    try {
      await setServerAddress(display);
      const { roster } = await pairTill(display, web, seeded, {
        terminalName: `Kitchen display ${crypto.randomUUID().slice(0, 6)}`,
        mode: "KITCHEN_DISPLAY",
      });
      const signedIn = await signInWithPin(display, roster, seeded.cashierStaffId, seeded.cashierPin, kds.pin);
      await body(signedIn.catalogResponse);
      // The till asks every mode for a shift before its work (an existing rule; reported).
      await openShift(display, 0, kds.tap);
      await expect(display.getByTestId("terminal-navigation")).toHaveCount(0);
      await expect(display.getByTestId("kitchen-board")).toBeVisible();

      await expect.poll(() => kdsTold.tickets.at(-1)?.filter((entry) => entry.orderId === order.id).length).toBe(1);
      const ticket = kdsTold.tickets.at(-1)!.find((entry) => entry.orderId === order.id)!;
      const card = display.getByTestId(`kitchen-ticket-${ticket.id}`);
      await expect(display.getByTestId("kitchen-column-SENT").getByTestId(`kitchen-ticket-${ticket.id}`)).toBeVisible();
      await expect(card).toContainText(`Sent ${clock(ticket.createdAt)}`);

      let version = ticket.version;
      for (const step of [
        { target: "PREPARING", column: "PREPARING" },
        { target: "READY", column: "READY" },
        { target: "SERVED", column: null },
      ]) {
        const moved = nextApi(display, "POST", new RegExp(`^/api/v1/pos/station-tickets/${ticket.id}/status/${step.target}$`));
        await kds.tap(display.getByTestId(`kitchen-next-${ticket.id}`));
        const response = await moved;
        expect(response.status()).toBe(204);
        expect(JSON.parse(response.request().postData() ?? "{}")).toEqual({ version });
        // What Yetu lists next: the ticket at its new step (gone once served), and the board with it.
        const latest = () => kdsTold.tickets.at(-1)?.find((entry) => entry.id === ticket.id);
        if (step.column) {
          await expect.poll(() => latest()?.status).toBe(step.target);
          version = latest()!.version;
          await expect(display.getByTestId(`kitchen-column-${step.column}`).getByTestId(`kitchen-ticket-${ticket.id}`)).toBeVisible();
        } else {
          await expect.poll(() => kdsTold.tickets.at(-1)?.some((entry) => entry.id === ticket.id)).toBe(false);
          await expect(card).toHaveCount(0);
        }
      }
      expect(kdsEvidence.pageErrors, "uncaught errors on the kitchen display").toEqual([]);
      await testInfo.attach("kitchen-display-api-calls.txt", { body: kdsEvidence.calls.join("\n"), contentType: "text/plain" });
      expect(kds.swallowed(), "taps the idle-lock countdown took on the display").toBe(0);
    } finally {
      await context.close();
    }
  });

  await test.step("9. Orders, left open on the selling till, shows order B served by the kitchen", async () => {
    const order = orderB!;
    // Nothing on the selling till was touched. Orders comes up to date by itself: from Yetu's live
    // station-ticket news where a worker relays it, and otherwise (this suite's API runs no outbox
    // worker, so no live update reaches a till) within orders.refreshSeconds.
    const detail = page.getByRole("dialog", { name: `Order ${order.orderNumber}` });
    await expect(detail.getByTestId("order-detail-status")).toHaveText("Served", { timeout: ORDERS_REFRESH_SECONDS * 1000 + 10_000 });
    expect(told.orders.at(-1)?.find((entry) => entry.id === order.id)?.status, "the order follows its station ticket").toBe("SERVED");
    await tap(detail.getByRole("button", { name: "Close" }).first());
    await expect(page.getByTestId(`order-row-${order.id}`)).toContainText("Served");
  });

  await testInfo.attach("api-calls.txt", { body: till.calls.join("\n"), contentType: "text/plain" });
  await testInfo.attach("page-errors.txt", { body: till.pageErrors.join("\n") || "none", contentType: "text/plain" });
  expect(swallowed(), "taps the idle-lock countdown took instead of the button pressed").toBe(0);
  expect(till.pageErrors, "uncaught errors in the till").toEqual([]);
});
