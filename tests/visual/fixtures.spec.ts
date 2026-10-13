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
      // container inside the window scrolls it on purpose. Content that a
      // clipping container cuts off (the shell clips at the window's edge)
      // cannot be reached, so it counts.
      if (document.documentElement.scrollWidth > viewportWidth + 1) {
        findings.push({ key: "overflow", detail: `the page is ${document.documentElement.scrollWidth}px wide in a ${viewportWidth}px window` });
      }
      for (const element of document.querySelectorAll("body *")) {
        if (!rendered(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.right <= viewportWidth + 1 && rect.left >= -1) continue;
        let contained = false;
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const overflowX = getComputedStyle(parent).overflowX;
          if (overflowX === "auto" || overflowX === "scroll") {
            const box = parent.getBoundingClientRect();
            if (box.right <= viewportWidth + 1 && box.left >= -1) {
              contained = true;
              break;
            }
          }
        }
        if (!contained) findings.push({ key: "overflow", detail: `${describe(element)} reaches ${Math.round(rect.right)}px` });
      }

      // A screen marked must-fit shows everything without scrolling the screen itself.
      for (const element of document.querySelectorAll("[data-must-fit]")) {
        const over = element.scrollHeight - element.clientHeight;
        if (over > 1) findings.push({ key: "must-fit", detail: `${describe(element)} needs ${over}px more height` });
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

      // A field's focus ring (3px, 2px out) never touches another control: fields and their
      // actions keep the system's spacing. Controls drawn inside the field (a clear button) are part of it.
      const RING = 5;
      const controls = [...document.querySelectorAll("button, a[href], summary, select, [role=button], [role=tab], [role=radio], [role=option]")];
      for (const field of document.querySelectorAll("input:not([type=hidden]), textarea, select")) {
        if (!rendered(field)) continue;
        // A field behind an open modal can't take focus, so its ring never shows.
        if (field.closest('[aria-hidden="true"], [inert]')) continue;
        const box = field.getBoundingClientRect();
        for (const other of controls) {
          if (other === field || other.contains(field) || field.contains(other) || !rendered(other)) continue;
          // Controls behind an open modal are hidden from use; they are not neighbours.
          if (other.closest('[aria-hidden="true"], [inert]')) continue;
          // Only the part of a control its scrolling or clipping containers show can be touched.
          let { left, top, right, bottom } = other.getBoundingClientRect();
          for (let parent = other.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (style.overflowX === "visible" && style.overflowY === "visible") continue;
            const clip = parent.getBoundingClientRect();
            left = Math.max(left, clip.left);
            top = Math.max(top, clip.top);
            right = Math.min(right, clip.right);
            bottom = Math.min(bottom, clip.bottom);
          }
          if (right - left < 1 || bottom - top < 1) continue;
          const rect = { left, top, right, bottom };
          const inside = rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom;
          if (inside) continue;
          const touches =
            rect.left < box.right + RING && rect.right > box.left - RING && rect.top < box.bottom + RING && rect.bottom > box.top - RING;
          if (touches) findings.push({ key: "focus-ring", detail: `${describe(field)} ring touches ${describe(other)}` });
        }
      }

      // The register: the ticket keeps its width beside the menu (400px from
      // 1280 wide, 360px below) and the menu shows 3, 4 or 6 columns.
      // Measured while browsing: under an open sheet the page beneath is out of use
      // (and the sheet's scroll lock may shift it), so it is not measured then.
      const ticket = document.querySelector('[data-testid="ticket-panel"]');
      if (ticket && rendered(ticket) && !ticket.closest('[aria-hidden="true"], [inert]')) {
        const wantWidth = viewportWidth < 1280 ? 360 : 400;
        const wantColumns = viewportWidth < 1280 ? 3 : viewportWidth < 1600 ? 4 : 6;
        const box = ticket.getBoundingClientRect();
        if (Math.abs(box.width - wantWidth) > 1) {
          findings.push({ key: "register-layout", detail: `the ticket is ${Math.round(box.width)}px wide, not ${wantWidth}px` });
        }
        if (box.right < viewportWidth - 1 || box.top < 0 || box.bottom > window.innerHeight + 1) {
          findings.push({
            key: "register-layout",
            detail: `the ticket is not fully on screen at the right (right ${Math.round(box.right)}, top ${Math.round(box.top)}, bottom ${Math.round(box.bottom)} in ${viewportWidth}x${window.innerHeight})`,
          });
        }
        const grid = document.querySelector('[data-testid="menu-grid"]');
        const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
        // A menu with nothing to show (none saved for working offline, or it didn't load) shows
        // its empty state instead of a grid; only that may stand in for the grid.
        const emptyMenu = !grid && Boolean(document.querySelector('[aria-label="Menu"] .y-empty'));
        if (columns !== wantColumns && !emptyMenu) {
          findings.push({ key: "register-layout", detail: `the menu has ${columns} columns, not ${wantColumns}` });
        }
        // The menu sits beside the ticket, on screen: left of it, starting within the window.
        if (grid) {
          const menu = grid.getBoundingClientRect();
          if (menu.right > box.left + 1 || menu.top >= Math.min(box.bottom, window.innerHeight) || menu.left < 0) {
            findings.push({
              key: "register-layout",
              detail: `the menu is not beside the ticket (menu ${Math.round(menu.left)},${Math.round(menu.top)}; ticket starts at ${Math.round(box.left)})`,
            });
          }
        }
      }

      // The kitchen: each column's first ticket has its next step on screen,
      // inside what the column shows, and no ticket's step is cut off by its
      // own card (a long ticket scrolls its items, never its step).
      for (const column of document.querySelectorAll("[data-kitchen-column]")) {
        if (!rendered(column) || column.closest('[aria-hidden="true"], [inert]')) continue;
        const shows = (column.querySelector(".y-kcol__body") ?? column).getBoundingClientRect();
        const first = column.querySelector("[data-kitchen-next]");
        if (first && rendered(first)) {
          const step = first.getBoundingClientRect();
          const top = Math.max(0, shows.top);
          const bottom = Math.min(window.innerHeight, shows.bottom);
          if (step.top < top - 1 || step.bottom > bottom + 1 || step.left < 0 || step.right > viewportWidth + 1) {
            findings.push({
              key: "kitchen-layout",
              detail: `${describe(first)} is not on screen in its column (top ${Math.round(step.top)}, bottom ${Math.round(step.bottom)}; the column shows ${Math.round(top)} to ${Math.round(bottom)})`,
            });
          }
        }
      }
      for (const card of document.querySelectorAll(".y-kticket")) {
        const next = card.querySelector("[data-kitchen-next]");
        if (!next || !rendered(card)) continue;
        const step = next.getBoundingClientRect();
        const box = card.getBoundingClientRect();
        if (step.top < box.top - 1 || step.bottom > box.bottom + 1) {
          findings.push({ key: "kitchen-layout", detail: `${describe(next)} is cut off by its ticket (step ${Math.round(step.bottom)}, ticket ${Math.round(box.bottom)})` });
        }
      }

      // In an open sheet or dialog, its primary action and its Close are on screen
      // without scrolling: a sale is never finished below the fold.
      for (const dialog of document.querySelectorAll('[role="dialog"]')) {
        if (!rendered(dialog) || dialog.closest('[aria-hidden="true"], [inert]')) continue;
        const actions = [
          ...dialog.querySelectorAll(".y-button--primary"),
          ...dialog.querySelectorAll('[aria-label="Close"]'),
        ].filter(rendered);
        for (const action of actions) {
          const rect = action.getBoundingClientRect();
          if (rect.top < 0 || rect.left < 0 || rect.bottom > window.innerHeight + 1 || rect.right > viewportWidth + 1) {
            findings.push({
              key: "sheet-actions",
              detail: `${describe(action)} is off screen (top ${Math.round(rect.top)}, bottom ${Math.round(rect.bottom)} in ${viewportWidth}x${window.innerHeight})`,
            });
          }
        }
      }

      // A control's words are never cut: nothing written in a button, tab or
      // choice runs past its own edges, nor anything marked to stay whole (an
      // order number).
      for (const control of document.querySelectorAll("button, [role=tab], [role=radio], [data-whole]")) {
        if (!rendered(control) || control.closest('[aria-hidden="true"], [inert]')) continue;
        const style = getComputedStyle(control);
        if (style.overflowX !== "visible" && style.textOverflow === "ellipsis") continue;
        if (control.scrollWidth > control.clientWidth + 1) {
          findings.push({ key: "clipped-words", detail: `${describe(control)} needs ${control.scrollWidth}px, has ${control.clientWidth}px` });
        }
      }

      // No interactive target under 48px either way.
      const interactive = [
        "button",
        "summary",
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
