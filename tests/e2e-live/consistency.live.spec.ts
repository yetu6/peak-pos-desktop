/**
 * One order's money reads the same on every surface of the till, against a live Yetu API (no fixtures, nothing
 * mocked, no amount written in this file: every figure checked is the one Yetu returned to the till).
 *
 * Steps: pair, sign in, open a shift -> sell a dish, and two plates of chips -> print for the kitchen -> cancel
 * one chips (a supervisor approves) -> take 10 percent off (a supervisor approves) -> the figures on Sell, in the
 * order sheet in Orders, and on the bill paper agree with Yetu's and with each other: the lines add up to the
 * Subtotal, less the discount, plus VAT, is the Total -> pay part in cash and the rest by mobile money -> the
 * bill sheet, the paid order and the Orders list read the same total -> close the shift on the exact count.
 *
 * Run as the other live suites (tests/e2e-live/live-api.sh), on a freshly seeded restaurant.
 */
import { expect, test, type Page, type Response } from "@playwright/test";
import { WebSession, ensurePlainDish, loadSeededProperty, chooseApprovers, SEEDED_MANAGER_ROLE, typed } from "./liveApi";
import { LIVE_API_URL } from "./liveSettings";
import { body, nextApi, openShift, pairTill, setServerAddress, signInWithPin, tapper } from "./liveTill";

const OPENING_FLOAT_MINOR = 5_000_000;

interface Order {
  id: string;
  version: number;
  status: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  pricesIncludeTax?: boolean;
  items: Array<{ name: string; quantity: number; status: string; taxMinor: number; totalMinor: number }>;
}

/** "TSh 12,345.50" as minor units. */
function minor(words: string): number {
  const figure = words.replace(/[^\d.]/g, "");
  return Math.round(Number.parseFloat(figure) * 100);
}

/** Every money figure in a piece of text, in order. */
function moneyIn(words: string): number[] {
  return [...words.matchAll(/TSh\s*[\d,]+(?:\.\d+)?/g)].map((match) => minor(match[0]));
}

function watchOrders(page: Page) {
  const seen = new Map<string, Order>();
  page.on("response", (response: Response) => {
    if (!response.url().startsWith(LIVE_API_URL) || !response.ok()) return;
    if (!/\/api\/v1\/pos\/orders(\/[0-9a-f-]{36})?(\/(items|discount|send|payments|void))?$/.test(new URL(response.url()).pathname)) return;
    void response.json().then(
      (json: unknown) => {
        const order = (json as { order?: Order }).order ?? (json as Order);
        if (order && typeof order.id === "string" && typeof order.totalMinor === "number" && Array.isArray(order.items)) {
          const known = seen.get(order.id);
          if (!known || order.version >= known.version) seen.set(order.id, order);
        }
      },
      () => undefined,
    );
  });
  return seen;
}

test("one order's money reads the same everywhere, against the live API", async ({ page }) => {
  const seeded = loadSeededProperty();
  const web = new WebSession();
  await web.signIn(seeded.ownerEmail);
  const dish = await ensurePlainDish(web, seeded);
  await chooseApprovers(web, seeded, SEEDED_MANAGER_ROLE);
  const { tap, pin } = tapper(page);
  const orders = watchOrders(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  let staff: Array<{ id: string; displayName: string }> = [];

  await test.step("1. Pair, sign in, open the shift", async () => {
    await setServerAddress(page);
    const { roster } = await pairTill(page, web, seeded, { terminalName: `Money till ${crypto.randomUUID().slice(0, 6)}` });
    const signedIn = await signInWithPin(page, roster, seeded.cashierStaffId, seeded.cashierPin, pin);
    staff = signedIn.staff;
    await body(signedIn.catalogResponse);
    await openShift(page, OPENING_FLOAT_MINOR, tap);
  });
  const manager = () => staff.find((person) => person.id === seeded.managerStaffId)!;

  let orderId = "";
  await test.step("2. Sell two plates of chips, and the House Special, and print for the kitchen", async () => {
    await tap(page.getByTestId("nav-new"));
    await tap(page.getByTestId("menu-House Special"));
    const created = nextApi(page, "POST", /^\/api\/v1\/pos\/orders$/);
    await tap(page.getByTestId("modifier-confirm-add"));
    orderId = (await body<Order>(created, 201)).id;
    await expect(page.getByTestId("cart-House Special")).toBeVisible();
    await tap(page.getByTestId(`menu-${dish.name}`));
    await expect(page.getByTestId(`cart-${dish.name}`)).toBeVisible();
    await tap(page.getByTestId(`menu-${dish.name}`));
    await expect(page.getByTestId(`cart-${dish.name}`)).toContainText("2");
    await tap(page.getByTestId("send-order"));
    await tap(page.getByTestId("paper-print"));
    await expect(page.getByTestId("ticket-sent")).toBeVisible();
  });

  await test.step("3. Cancel one of the two chips: a supervisor approves", async () => {
    await tap(page.getByTestId(`cart-${dish.name}`).locator("button").first());
    await tap(page.getByTestId("void-line"));
    await expect(page.getByTestId("void-item-dialog")).toBeVisible();
    // Of the two plates, one goes: the dialog starts on all of them.
    await tap(page.getByTestId("void-item-dialog").getByRole("button", { name: /One fewer/ }));
    await tap(page.getByTestId("void-item-reason-0"));
    await tap(page.getByTestId("void-item-dialog").getByRole("radio", { name: new RegExp(manager().displayName) }));
    await pin("void-item-pin-key", seeded.managerPin);
    const voided = nextApi(page, "POST", /\/void-item$|\/items\/[0-9a-f-]{36}\/void$/);
    await tap(page.getByTestId("confirm-void-item"));
    expect((await voided).ok()).toBe(true);
    await expect(page.getByTestId("void-item-dialog")).toHaveCount(0);
  });

  await test.step("4. Take 10 percent off: a supervisor approves", async () => {
    await tap(page.getByRole("button", { name: "More" }));
    await tap(page.getByRole("button", { name: /^Discount/ }));
    await tap(page.getByRole("radio", { name: "Percent" }));
    await page.getByTestId("discount-value").fill("10");
    await tap(page.getByTestId("discount-reason-0"));
    await tap(page.getByTestId("discount-dialog").getByRole("radio", { name: new RegExp(manager().displayName) }));
    await pin("discount-pin-key", seeded.managerPin);
    const applied = nextApi(page, "POST", /\/discount$/);
    await tap(page.getByTestId("confirm-discount"));
    expect((await applied).ok()).toBe(true);
    await expect(page.getByTestId("cart-discount")).toBeVisible();
  });

  /** What Yetu has for the order now. */
  const yetu = () => orders.get(orderId)!;

  await test.step("5. Sell: the lines add up, and the figures are Yetu's", async () => {
    await page.waitForTimeout(500);
    const order = yetu();
    const live = order.items.filter((line) => line.status !== "VOIDED");
    expect(live.map((line) => line.name).sort()).toEqual(["Chips", "House Special"]);
    expect(order.discountMinor, "a 10 percent discount came off").toBeGreaterThan(0);
    const totals = page.getByTestId("ticket-totals");
    await expect(page.getByTestId("cart-preview-total")).toHaveText(`TSh ${(order.totalMinor / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`);
    const shown = moneyIn(await totals.innerText());
    expect(shown, "Subtotal, Discount, VAT, Total").toContain(order.totalMinor);
    // Each line without its VAT adds up to the Subtotal; less the discount, plus VAT, is the Total.
    const linesOnScreen = (await page.getByTestId("ticket-panel").locator("li[data-testid^='cart-']").allInnerTexts()).flatMap(moneyIn);
    const sumOfLines = linesOnScreen.reduce((sum, amount) => sum + amount, 0);
    const itemsFigure = order.pricesIncludeTax ? live.reduce((sum, line) => sum + line.totalMinor, 0) : order.subtotalMinor;
    expect(sumOfLines, "the lines on Sell add up to the figure under them").toBe(itemsFigure);
    expect(order.subtotalMinor - order.discountMinor + order.taxMinor, "Subtotal, less the discount, plus VAT").toBe(order.totalMinor);
  });

  await test.step("6. The bill on paper: the same lines and the same total", async () => {
    await tap(page.getByTestId("print-bill"));
    const paper = page.getByTestId("paper-text");
    await expect(paper).toBeVisible();
    const text = await paper.innerText();
    const order = yetu();
    const toPay = text.split("\n").find((row) => row.startsWith("TO PAY"))!;
    expect(moneyIn(toPay)).toEqual([order.totalMinor]);
    const total = text.split("\n").find((row) => row.startsWith("TOTAL"))!;
    expect(moneyIn(total)).toEqual([order.totalMinor]);
    // The paper's rows all end at one edge: the items table and the totals.
    const rows = text.split("\n").filter((row) => /TSh [\d,.]+$/.test(row.trimEnd()) && !row.startsWith("Printed"));
    expect(new Set(rows.map((row) => row.trimEnd().length)).size, `every money row ends at the same column:\n${rows.join("\n")}`).toBe(1);
    const itemRows = text.split("\n").slice(text.split("\n").findIndex((row) => /^ITEM\s+QTY\s+AMOUNT/.test(row)) + 1).filter((row) => /TSh/.test(row)).slice(0, 2);
    const onPaper = itemRows.flatMap(moneyIn).reduce((sum, amount) => sum + amount, 0);
    expect(onPaper, "the bill's lines add up to what the Subtotal says").toBe(order.pricesIncludeTax ? yetu().items.filter((l) => l.status !== "VOIDED").reduce((s, l) => s + l.totalMinor, 0) : order.subtotalMinor);
    await tap(page.getByRole("button", { name: "Back" }).first());
  });

  await test.step("7. Orders: the sheet and the row say the same", async () => {
    await tap(page.getByTestId("nav-orders"));
    const row = page.getByTestId(`order-row-${orderId}`);
    await expect(row).toContainText(`${(yetu().totalMinor / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`);
    await tap(row);
    const totals = page.getByTestId("order-detail-totals");
    await expect(totals).toBeVisible();
    expect(moneyIn(await totals.innerText())).toContain(yetu().totalMinor);
    const lines = (await page.getByTestId("order-detail-lines").locator("li").allInnerTexts()).flatMap(moneyIn).reduce((sum, amount) => sum + amount, 0);
    expect(lines, "the sheet's lines add up to the figure under them").toBe(yetu().pricesIncludeTax ? yetu().items.filter((l) => l.status !== "VOIDED").reduce((s, l) => s + l.totalMinor, 0) : yetu().subtotalMinor);
    await page.keyboard.press("Escape");
  });

  let cashPart = 0;
  await test.step("8. Pay part in cash and the rest by mobile money", async () => {
    await tap(page.getByTestId("nav-new"));
    await tap(page.getByTestId("pay-order"));
    cashPart = Math.floor(yetu().totalMinor / 2 / 100_000) * 100_000;
    await page.getByTestId("amount-received").fill(typed(cashPart));
    await tap(page.getByTestId("confirm-settle"));
    await expect(page.getByTestId("tender-recorded")).toBeVisible();
    await tap(page.getByTestId("method-MOBILE_MONEY"));
    await page.getByTestId("tender-reference").fill("MPESA-CONSISTENCY");
    await tap(page.getByTestId("confirm-settle"));
    await expect(page.getByTestId("payment-done")).toBeVisible();
    await expect(page.getByTestId("payment-done")).toContainText(`${(yetu().totalMinor / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`);
  });

  await test.step("9. The bill sheet, the paid order and its history agree on the total and on how it was paid", async () => {
    await tap(page.getByRole("button", { name: "View bill" }));
    const sheet = page.getByTestId("receipt-document");
    await expect(sheet).toBeVisible();
    expect(moneyIn(await sheet.innerText())).toContain(yetu().totalMinor);
    await expect(sheet).toContainText("Split payment");
    const billLines = (await sheet.locator(".y-receipt__line").allInnerTexts()).flatMap(moneyIn).reduce((sum, amount) => sum + amount, 0);
    expect(billLines, "the bill sheet's lines add up to the figure under them").toBe(yetu().pricesIncludeTax ? yetu().items.filter((l) => l.status !== "VOIDED").reduce((s, l) => s + l.totalMinor, 0) : yetu().subtotalMinor);
    await page.keyboard.press("Escape");
    // Esc leaves the bill, and the Paid screen goes with it when it was still up.
    const stillDone = page.getByTestId("payment-done").getByRole("button", { name: "New sale" });
    if (await stillDone.isVisible().catch(() => false)) await tap(stillDone);
    await tap(page.getByTestId("nav-orders"));
    await tap(page.getByRole("tab", { name: /Paid/ }));
    await tap(page.getByTestId(`order-row-${orderId}`));
    const payments = page.getByTestId("order-detail-timeline");
    await expect(payments).toContainText("Cash");
    await expect(payments).toContainText("Mobile money");
    const paid = moneyIn(await payments.innerText());
    expect(paid.reduce((a, b) => a + b, 0), "the two payments in the history make up the total").toBeGreaterThanOrEqual(yetu().totalMinor);
    await page.keyboard.press("Escape");
  });

  await test.step("10. Close the shift on the exact count", async () => {
    await tap(page.getByTestId("nav-manager"));
    await tap(page.getByTestId("open-close-shift"));
    const shiftExpected = OPENING_FLOAT_MINOR + cashPart;
    await page.getByTestId("counted-cash").fill(typed(shiftExpected));
    await tap(page.getByRole("button", { name: "Check the count" }));
    await expect(page.getByTestId("close-expected")).toHaveText(`TSh ${(shiftExpected / 100).toLocaleString("en-GB")}`);
    await expect(page.getByTestId("close-outcome")).toHaveText("Balanced. The drawer matches what Yetu expects.");
    await tap(page.getByTestId("close-shift"));
    await expect(page.getByTestId("shell-state")).toHaveText("NO_SHIFT");
    await expect(page.getByTestId("closed-shift-summary")).toBeVisible();
  });

  expect(pageErrors).toEqual([]);
});
