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

for (const [width,height] of [[1366,768],[1920,1080]]) for (const theme of ["light","dark"]) for (const fixture of ["papers-80","papers-58","papers-copy","papers-cancel"]) {
 test(`W5 ${fixture} ${width} ${theme}`,async({page})=>{
  await page.setViewportSize({width,height});
  await page.addInitScript(value=>localStorage.setItem("yetu-till-theme",value),theme);
  const {mkdir}=await import("node:fs/promises");await mkdir("docs/qa/till-w5/after",{recursive:true});
   await page.goto(`/?fixture=${fixture}`);await page.evaluate(()=>document.fonts.ready);
   const paper=page.getByTestId("paper-text");await expect(paper).toBeVisible();
   await expect(paper).toHaveCSS("background-color","rgb(255, 255, 255)");
   const text=await paper.textContent();expect(text).toContain("Powered by Yetu");expect(text).toContain("yetu.fbcsoftwares.com");
   if(fixture==="papers-copy")expect(text).toContain("COPY");
   else if(fixture==="papers-cancel"){expect(text).toContain("CANCELLED");expect(text).toContain("DO NOT MAKE");}
   else{expect(text!.indexOf("HAND OVER")).toBeLessThan(text!.indexOf("MAKE"));expect(text).not.toContain("TSh");}
   await page.screenshot({path:`docs/qa/till-w5/after/${fixture}-${width}x${height}-${theme}.png`});
   if(fixture==="papers-80"||fixture==="papers-58"){
    await page.getByRole("tab",{name:"Bill",exact:true}).click();
    await expect(paper).toContainText("TOTAL");await expect(paper).toContainText("TSh");
    await page.screenshot({path:`docs/qa/till-w5/after/bill-${fixture}-${width}x${height}-${theme}.png`});
   }
 });
}

// Owner, 2026-10-19: no room for mistakes. Cash is typed on the keypad, so its last row (00, 0, delete) is never
// left below the fold of the Pay sheet, on any window the till runs in.
for (const [width, height] of [[1024, 768], [1366, 768], [1920, 1080]]) {
  for (const fixture of ["pay-cash", "pay-split"]) {
    test(`the cash keypad is whole on screen: ${fixture} ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/?fixture=${fixture}`);
      await page.evaluate(() => document.fonts.ready);
      const keypad = page.locator(".y-keypad").first();
      await expect(keypad).toBeVisible();
      const gap = await keypad.evaluate((node) => {
        const body = node.closest(".y-sheet__body, .y-dialog__body") as HTMLElement;
        return body.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom;
      });
      expect(gap, "the keypad's bottom edge is inside the sheet body").toBeGreaterThanOrEqual(0);
    });
  }
}

// The Print for the kitchen / Print bill / More row: every label has its padding, at every window size.
for (const [width, height] of [[1024, 768], [1366, 768], [1920, 1080]]) {
  test(`the ticket's print buttons keep their words inside their padding: ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/?fixture=register");
    await page.evaluate(() => document.fonts.ready);
    const tight = await page.evaluate(() => {
      const out: string[] = [];
      // The fixture's first button says "Print order"; "Print for kitchen" is the longest it ever says.
      const first = document.querySelector<HTMLElement>(".y-actions__row > .y-button");
      const text = document.createTreeWalker(first!, NodeFilter.SHOW_TEXT).nextNode();
      if (text) text.nodeValue = "Print for kitchen";
      for (const button of document.querySelectorAll<HTMLElement>(".y-actions__row > .y-button")) {
        const box = button.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(button);
        const text = range.getBoundingClientRect();
        const left = text.left - box.left;
        const right = box.right - text.right;
        if (left < 6 || right < 6) out.push(`"${button.textContent?.trim()}" ${Math.round(left)}px left, ${Math.round(right)}px right`);
      }
      return out;
    });
    expect(tight).toEqual([]);
  });
}
