/**
 * The Restaurant & Bar module's menu on the till (S16-B4), in Chromium,
 * against a live Yetu API: the real app, the real fbc-peak routes
 * (fnbGetTillMenu, the manager's fnb routes, addItem with a size), a real
 * database. Nothing is mocked and no price is written here as the till's:
 * every amount checked is one Yetu returned.
 *
 * Steps: the owner switches menus on, puts the seeded dish's category in
 * Food and a new Beers category in Drinks, sells Tusker in two sizes and
 * tags the dish Halal -> the till shows Food and Drinks first, the tag on
 * the dish, the sizes on the beer -> a Pint is added and Yetu prices it as
 * the Pint -> the owner renames Food and sells out the Pint: the open till
 * shows both without a restart.
 *
 * Run as the other live suites (tests/e2e-live/live-api.sh), on a freshly
 * seeded restaurant, with FBC_PEAK_DIR at a checkout that has the module.
 */
import { expect, test, type Response } from "@playwright/test";
import { WebSession, loadSeededProperty, tsh } from "./liveApi";
import { LIVE_API_URL } from "./liveSettings";
import { body, nextApi, openShift, pairTill, setServerAddress, signInWithPin, tapper } from "./liveTill";

const OPENING_FLOAT_MINOR = 5_000_000;

interface Menu {
  menusEnabled: boolean;
  groups: Array<{ id: string; name: string; categoryIds: string[] }>;
}
interface Category { id: string; name: string }
interface Product { id: string; name: string; categoryId?: string; priceMinor: number }
interface Size { id: string; name: string; priceMinor: number; isDefault: boolean }
interface Tag { id: string; code: string; label: string }
interface Order { id: string; items: Array<{ productId: string; unitPriceMinor: number; quantity: number }> }

test("the till sells by the module's menu, in sizes, against the live API", async ({ page }, testInfo) => {
  const seeded = loadSeededProperty();
  const web = new WebSession();
  await web.signIn(seeded.ownerEmail);
  const base = `/api/v1/organizations/${seeded.organizationId}/properties/${seeded.propertyId}`;
  const run = crypto.randomUUID().slice(0, 4).toUpperCase();

  // The owner arranges the menu through Yetu's own routes, as Restaurant → Menu does.
  const menu = await web.call<Menu>(`${base}/fnb/outlets/${seeded.outletId}/settings`, { method: "PUT", body: { menusEnabled: true } });
  expect(menu.menusEnabled).toBe(true);
  const food = menu.groups.find((group) => group.name === "Food")!;
  const drinks = menu.groups.find((group) => group.name === "Drinks")!;
  expect(food && drinks, "switching menus on gives Food and Drinks").toBeTruthy();
  const dish = (await web.call<{ items: Product[] }>(`${base}/products?outletId=${seeded.outletId}`)).items.find((p) => p.id === seeded.productId)!;
  await web.call(`${base}/fnb/menu-groups/${food.id}/categories`, { method: "PUT", body: { categoryIds: [dish.categoryId] } });
  const beers = await web.call<Category>(`${base}/categories`, {
    method: "POST", body: { outletId: seeded.outletId, code: `BEERS_${run}`, name: `Beers ${run}`, prepStation: "BAR" },
  });
  await web.call(`${base}/fnb/menu-groups/${drinks.id}/categories`, { method: "PUT", body: { categoryIds: [beers.id] } });
  const beer = await web.call<Product>(`${base}/products`, {
    method: "POST", body: { outletId: seeded.outletId, categoryId: beers.id, code: `TUSK_${run}`, name: `Tusker ${run}`, priceMinor: 500_000, taxRateBp: 1800 },
  });
  const bottle = await web.call<Size>(`${base}/fnb/products/${beer.id}/sizes`, { method: "POST", body: { code: "BOTTLE", name: "Bottle", priceMinor: 500_000 } });
  const pint = await web.call<Size>(`${base}/fnb/products/${beer.id}/sizes`, { method: "POST", body: { code: "PINT", name: "Pint", priceMinor: 700_000 } });
  expect(bottle.isDefault, "the first size is the default").toBe(true);
  const halal = (await web.call<{ items: Tag[] }>(`${base}/fnb/tags`)).items.find((tag) => tag.code === "HALAL")!;
  await web.call(`${base}/fnb/products/${dish.id}/details`, { method: "PUT", body: { description: "Slow-cooked, with chips.", tagIds: [halal.id] } });

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
    const { roster } = await pairTill(page, web, seeded, { terminalName: `Menu till ${run}` });
    const signedIn = await signInWithPin(page, roster, seeded.cashierStaffId, seeded.cashierPin, pin);
    await body(signedIn.catalogResponse);
    await openShift(page, OPENING_FLOAT_MINOR, tap);
  });

  await test.step("2. Food and Drinks come first; staff's tag is on the dish; the beer shows its sizes", async () => {
    const tillMenu = nextApi(page, "GET", /^\/api\/v1\/fnb\/pos\/menu$/);
    await tap(page.getByTestId("nav-new"));
    await body(tillMenu);
    const groupTabs = page.getByRole("tablist", { name: "Menu", exact: true });
    await expect(groupTabs.getByRole("tab", { name: "Food" })).toBeVisible();
    await expect(groupTabs.getByRole("tab", { name: "Drinks" })).toBeVisible();
    await expect(page.getByTestId(`menu-${dish.name}`)).toContainText("Halal");
    await tap(groupTabs.getByRole("tab", { name: "Drinks" }));
    await expect(page.getByTestId(`menu-${beer.name}`)).toContainText(`${tsh(bottle.priceMinor)} · 2 sizes`);
    await expect(page.getByTestId(`menu-${dish.name}`)).toHaveCount(0);
  });

  await test.step("3. A Pint is added; Yetu prices it as the Pint", async () => {
    const created = nextApi(page, "POST", /^\/api\/v1\/pos\/orders$/);
    await tap(page.getByTestId(`menu-${beer.name}`));
    const sheet = page.getByTestId("modifier-dialog");
    await expect(sheet.getByTestId(`size-option-${bottle.id}`)).toHaveAttribute("aria-checked", "true");
    await tap(sheet.getByTestId(`size-option-${pint.id}`));
    const added = nextApi(page, "POST", /^\/api\/v1\/pos\/orders\/[^/]+\/items$/);
    await tap(sheet.getByTestId("modifier-confirm-add"));
    await body<Order>(created, 201);
    const order = await body<Order>(added);
    const line = order.items.find((item) => item.productId === beer.id)!;
    expect(line.unitPriceMinor, "Yetu priced the Pint").toBe(pint.priceMinor);
  });

  await test.step("4. The owner renames Food and sells out the Pint: the open till shows both", async () => {
    const reread = nextApi(page, "GET", /^\/api\/v1\/fnb\/pos\/menu$/);
    await web.call(`${base}/fnb/menu-groups/${food.id}`, { method: "PATCH", body: { name: `Kitchen ${run}` } });
    await body(reread);
    const groupTabs = page.getByRole("tablist", { name: "Menu", exact: true });
    await expect(groupTabs.getByRole("tab", { name: `Kitchen ${run}` })).toBeVisible();
    const again = nextApi(page, "GET", /^\/api\/v1\/fnb\/pos\/menu$/);
    await web.call(`${base}/fnb/sizes/${pint.id}`, { method: "PATCH", body: { isAvailable: false } });
    await body(again);
    await tap(groupTabs.getByRole("tab", { name: "Drinks" }));
    await tap(page.getByTestId(`menu-${beer.name}`));
    const sheet = page.getByTestId("modifier-dialog");
    await expect(sheet.getByTestId(`size-option-${pint.id}`)).toHaveAttribute("aria-disabled", "true");
    await expect(sheet.getByTestId(`size-option-${pint.id}`)).toContainText("Sold out");
  });

  await testInfo.attach("api-calls.txt", { body: calls.join("\n"), contentType: "text/plain" });
  expect(pageErrors, "uncaught errors in the till").toEqual([]);
});
