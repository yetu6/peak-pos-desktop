import { expect, test, type Page } from "@playwright/test";
import { FIT_SIZES, measureFit } from "./fit";

/**
 * Owner, 2026-10-29: on a small till screen the bottom of some screens was hidden. At each window size the
 * till runs in (the owner's own is 1280x690), every screen either fits or scrolls inside its own region:
 * nothing its person needs lies below the window or is cut off, and the page never scrolls sideways.
 * Measured at Standard (100%) so the layouts themselves are what is checked, not the automatic zoom.
 */
const SCREENS: Array<{ fixture: string; actions: string[] }> = [
  { fixture: "locked-roster", actions: [] },
  { fixture: "locked-pin", actions: [] },
  { fixture: "no-shift", actions: ["open-shift"] },
  { fixture: "open-shift-manager", actions: ["open-shift"] },
  { fixture: "register", actions: ["pay-order"] },
  { fixture: "register-round2", actions: ["pay-order"] },
  { fixture: "pay-cash", actions: [] },
  { fixture: "orders", actions: [] },
  { fixture: "kitchen", actions: [] },
  { fixture: "cash", actions: [] },
  { fixture: "close-count", actions: [] },
  { fixture: "status", actions: [] },
  { fixture: "printers", actions: [] },
];

async function open(page: Page, fixture: string, setting: string) {
  await page.addInitScript((value) => localStorage.setItem("yetu.displaySize", value), setting);
  await page.goto(`/?fixture=${fixture}`);
  await page.waitForFunction(() => (document.getElementById("root")?.childElementCount ?? 0) > 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
}

for (const size of FIT_SIZES) {
  for (const screen of SCREENS) {
    test(`${screen.fixture} fits ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await open(page, screen.fixture, "standard");
      expect(await measureFit(page)).toEqual([]);
      for (const id of screen.actions) {
        const box = await page.getByTestId(id).first().boundingBox();
        expect(box, `${id} is drawn`).not.toBeNull();
        expect(box!.y + box!.height, `${id} is inside the window`).toBeLessThanOrEqual(size.height + 1);
        expect(box!.y).toBeGreaterThanOrEqual(0);
      }
    });
  }
}

test("Automatic zoom brings the reference layout into a 1280x690 window", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 690 });
  await open(page, "register", "auto");
  const zoom = await page.evaluate(() => document.documentElement.style.zoom);
  expect(Number(zoom)).toBeCloseTo(0.86, 2);
});

test("Ctrl + / Ctrl - / Ctrl 0 change the display size and Status shows it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "printers", "standard");
  await page.keyboard.press("Control+-");
  await expect(page.getByTestId("display-size-now")).toContainText("Manual, 95%");
  await page.keyboard.press("Control+0");
  await expect(page.getByTestId("display-size-now")).toContainText("Standard, 100%");
  await page.getByTestId("display-bigger").click();
  await expect(page.getByTestId("display-size-now")).toContainText("Manual, 105%");
  await page.getByTestId("display-size-compact").click();
  await expect(page.getByTestId("display-size-now")).toContainText("Compact, 85%");
  expect(await page.evaluate(() => localStorage.getItem("yetu.displaySize"))).toBe("compact");
  await page.getByTestId("display-reset").click();
  await expect(page.getByTestId("display-size-now")).toContainText("Standard, 100%");
});
