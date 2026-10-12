import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { VISUAL_FIXTURE_NAMES } from "../../src/visual/fixtureNames";
import {
  KNOWN_DEBT,
  MIN_TARGET_PX,
  MIN_TECHNICAL_TEXT_PX,
  MIN_TEXT_PX,
  RESULTS_DIR,
  SCREENS_DIR,
  THEMES,
  VIEWPORTS,
  type Finding,
  type FixtureResult,
} from "./harness";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function open(page: Page, fixture: string, theme: string): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("yetu-till-theme", value);
  }, theme);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/?fixture=${fixture}`);
  await page.waitForFunction(() => (document.getElementById("root")?.childElementCount ?? 0) > 0);
  // Measure the settled screen: fonts in, and any sheet or fade finished.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const finite = document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
}

/** Overflow, text size and target size, measured in the page. */
async function measure(page: Page): Promise<Finding[]> {
  return page.evaluate(
    ({ minText, minTechnical, minTarget }) => {
      const findings: Array<{ key: string; detail: string }> = [];
      const viewportWidth = document.documentElement.clientWidth;

      const describe = (element: Element): string => {
        const id = element.getAttribute("data-testid");
        const label = element.getAttribute("aria-label");
        const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        const classes = typeof element.className === "string" ? element.className.split(/\s+/).slice(0, 2).join(".") : "";
        return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}${id ? `[${id}]` : ""}${label ? ` "${label}"` : text ? ` "${text}"` : ""}`;
      };

      const rendered = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) return false;
        const style = getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none";
      };

      // No horizontal overflow: nothing reaches past the window unless a
      // container inside the window clips it or scrolls it on purpose.
      if (document.documentElement.scrollWidth > viewportWidth + 1) {
        findings.push({ key: "overflow", detail: `the page is ${document.documentElement.scrollWidth}px wide in a ${viewportWidth}px window` });
      }
      for (const element of document.querySelectorAll("body *")) {
        if (!rendered(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.right <= viewportWidth + 1 && rect.left >= -1) continue;
        let contained = false;
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflowX !== "visible") {
            const box = parent.getBoundingClientRect();
            if (box.right <= viewportWidth + 1 && box.left >= -1) {
              contained = true;
              break;
            }
          }
        }
        if (!contained) findings.push({ key: "overflow", detail: `${describe(element)} reaches ${Math.round(rect.right)}px` });
      }

      // No operational text under 14px; 13px only inside technical details.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? "").trim();
        const parent = node.parentElement;
        if (!text || !parent || !rendered(parent)) continue;
        const size = Number.parseFloat(getComputedStyle(parent).fontSize);
        if (size >= minText) continue;
        if (size >= minTechnical && parent.closest("[data-technical]")) continue;
        findings.push({ key: "text-size", detail: `${size}px: "${text.slice(0, 40)}" in ${describe(parent)}` });
      }

      // No interactive target under 48px either way.
      const interactive = [
        "button",
        "a[href]",
        "input:not([type=hidden])",
        "select",
        "textarea",
        "[role=button]",
        "[role=tab]",
        "[role=menuitem]",
        "[role=option]",
        "[role=radio]",
        "[role=switch]",
        "[role=checkbox]",
        "[tabindex]:not([tabindex='-1'])",
      ].join(",");
      for (const element of document.querySelectorAll(interactive)) {
        if (!rendered(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < minTarget - 0.5 || rect.height < minTarget - 0.5) {
          findings.push({ key: "target-size", detail: `${Math.round(rect.width)}x${Math.round(rect.height)}: ${describe(element)}` });
        }
      }
      return findings;
    },
    { minText: MIN_TEXT_PX, minTechnical: MIN_TECHNICAL_TEXT_PX, minTarget: MIN_TARGET_PX },
  );
}

async function screenshot(page: Page, file: string): Promise<void> {
  // A gallery scrolls inside the till's fixed window; let it grow for the picture.
  await page.addStyleTag({
    content: "html, body, #root { height: auto !important; overflow: visible !important; } .y-gallery { height: auto !important; overflow: visible !important; }",
  });
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
}

for (const fixture of VISUAL_FIXTURE_NAMES) {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${fixture} at ${viewport.name} in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await open(page, fixture, theme);

        const findings = await measure(page);
        const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        for (const violation of axe.violations) {
          const nodes = violation.nodes.slice(0, 4).map((node) => node.target.join(" ")).join(" | ");
          findings.push({ key: `axe:${violation.id}`, detail: `${violation.help}: ${nodes}` });
        }

        const tag = `${fixture}--${viewport.name}--${theme}`;
        const result: FixtureResult = { fixture, viewport: viewport.name, theme, findings };
        writeFileSync(join(RESULTS_DIR, `${tag}.json`), JSON.stringify(result, null, 2));
        await screenshot(page, join(SCREENS_DIR, `${tag}.png`));

        const allowed = new Set(KNOWN_DEBT[fixture]?.keys ?? []);
        const unexpected = findings.filter((finding) => !allowed.has(finding.key));
        expect(unexpected, `${tag}: findings`).toEqual([]);
      });
    }
  }
}
