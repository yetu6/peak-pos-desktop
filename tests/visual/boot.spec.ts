import { expect, test } from "@playwright/test";

/**
 * First paint: before the app's code or stylesheet arrive, the page is
 * already in the right theme. The app's own module is blocked here, so only
 * index.html and the boot script it loads have run: that is the first paint.
 */
const CASES: Array<{ name: string; storage: Record<string, string>; theme: "light" | "dark"; background: string }> = [
  { name: "a new device", storage: {}, theme: "light", background: "rgb(238, 241, 246)" },
  { name: "a kitchen display nobody chose for", storage: { "yetu-till-mode-theme": "dark" }, theme: "dark", background: "rgb(10, 22, 38)" },
  { name: "a person who chose Dark", storage: { "yetu-till-theme": "dark" }, theme: "dark", background: "rgb(10, 22, 38)" },
  {
    name: "a kitchen display where a person chose Light",
    storage: { "yetu-till-mode-theme": "dark", "yetu-till-theme": "light" },
    theme: "light",
    background: "rgb(238, 241, 246)",
  },
  { name: "a till with only the old key", storage: { "peak-pos-theme": "dark" }, theme: "light", background: "rgb(238, 241, 246)" },
];

for (const { name, storage, theme, background } of CASES) {
  test(`first paint is ${theme} for ${name}`, async ({ page }) => {
    await page.addInitScript((values) => {
      for (const [key, value] of Object.entries(values)) window.localStorage.setItem(key, value);
    }, storage);
    await page.route("**/src/main.tsx*", (route) => route.abort());
    await page.goto("/");
    const painted = await page.evaluate(() => ({
      classes: [...document.body.classList].sort(),
      background: getComputedStyle(document.documentElement).backgroundColor,
      appRan: document.getElementById("yetu-start") === null,
      startText: document.getElementById("yetu-start")?.textContent ?? "",
      startColour: getComputedStyle(document.getElementById("yetu-start")!).backgroundColor,
      markShown: (document.querySelector<HTMLImageElement>("#yetu-start img")?.getBoundingClientRect().width ?? 0) > 0,
    }));
    expect(painted.appRan).toBe(false);
    expect(painted.classes).toEqual(theme === "dark" ? ["dark", "dark-theme"] : ["light-theme"]);
    expect(painted.background).toBe(background);
    // The start screen itself is painted in the theme's canvas, never white, with the mark and the words.
    expect(painted.startColour).toBe(background);
    expect(painted.startText).toContain("Starting Yetu");
    expect(painted.markShown).toBe(true);
    await page.screenshot({ path: `visual-output/start-screen-${theme}-${name.replace(/\W+/g, "-")}.png` });
  });
}

test("React replaces the start screen when it mounts", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => document.getElementById("yetu-start") === null, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => (document.getElementById("root")?.childElementCount ?? 0) > 0)).toBe(true);
});
