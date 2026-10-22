import { expect, test } from "@playwright/test";

for (const [width, height, columns] of [[1366, 768, 4], [1920, 1080, 6]]) {
  for (const theme of ["light", "dark"]) {
    test(`Sell keeps the menu, ticket and Pay visible: ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript((value) => localStorage.setItem("yetu-till-theme", value), theme);
      await page.goto("/?fixture=register");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByTestId("ticket-panel")).toHaveCSS("width", "400px");
      const grid = page.locator(".y-menu-grid").first();
      expect(await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(columns);
      await expect(page.getByTestId("open-orders")).toBeVisible();
      await expect(page.getByRole("button", { name: "Print bill", exact: true })).toBeVisible();
      const pay = page.getByTestId("pay-order");
      await expect(pay).toBeVisible();
      const box = await pay.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(64);
      expect((box?.y ?? height) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
    });

    test(`paper stays white: ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript((value) => localStorage.setItem("yetu-till-theme", value), theme);
      await page.goto("/?fixture=receipt");
      await expect(page.locator(".y-receipt__paper")).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(page.locator(".y-receipt__paper")).toHaveCSS("color", "rgb(16, 32, 47)");
    });
  }
}

for (const [width,height] of [[1366,768],[1920,1080]]) for (const theme of ["light","dark"]) {
 test(`optional order prompts ${width} ${theme}`, async({page})=>{
  await page.setViewportSize({width,height});
  await page.addInitScript(value=>localStorage.setItem("yetu-till-theme",value),theme);
  await page.goto("/?fixture=register-no-table");
  await expect(page.getByRole("textbox",{name:"Name (optional)"})).toBeVisible();
  await expect(page.getByRole("textbox",{name:/Table/})).toHaveCount(0);
  await page.getByRole("textbox",{name:"Name (optional)"}).fill("12");
  await expect(page.getByRole("textbox",{name:"Name (optional)"})).toHaveValue("12");
  await page.evaluate(()=>document.fonts.ready);
  const {mkdir}=await import("node:fs/promises");
  await mkdir("docs/qa/till-w4/after",{recursive:true});
  await page.screenshot({path:`docs/qa/till-w4/after/name-${width}x${height}-${theme}.png`});
  await page.goto("/?fixture=register-guests");
  const guests=page.getByRole("group",{name:"Guests (optional) quantity"});
  await expect(guests).toBeVisible();
  await guests.getByRole("button",{name:"One more Guests (optional)"}).click();
  await expect(guests.locator("output")).toHaveText("1");
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:`docs/qa/till-w4/after/guests-${width}x${height}-${theme}.png`});
  await page.getByRole("radio",{name:"Takeaway",exact:true}).click();
  await expect(page.getByRole("group",{name:"Guests (optional) quantity"})).toHaveCount(0);
 });
}
