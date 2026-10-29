import type { Page } from "@playwright/test";

/** The window sizes small tills run in (owner report, 2026-10-29: a small-screen till hid its bottom controls).
 * 1280x690 is the owner's till: 1920x1080 at Windows scale 150% less the title bar; 1536x864 is the 125% case. */
export const FIT_SIZES = [
  { width: 1024, height: 600 },
  { width: 1280, height: 690 },
  { width: 1280, height: 720 },
  { width: 1536, height: 864 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
] as const;

export interface FitFinding {
  key: "page-wide" | "unreachable";
  detail: string;
}

/**
 * What a person cannot get to: a button, field or link that lies outside the window
 * with no scrolling region that would bring it in, or that a clipping box cuts off.
 * Also any horizontal page scroll. Pure measurement, run inside the page.
 */
export async function measureFit(page: Page): Promise<FitFinding[]> {
  return page.evaluate(() => {
    const findings: Array<{ key: "page-wide" | "unreachable"; detail: string }> = [];
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (document.documentElement.scrollWidth > vw + 1) {
      findings.push({ key: "page-wide", detail: `the page is ${document.documentElement.scrollWidth}px wide in ${vw}px` });
    }
    const describe = (el: Element) => {
      const id = el.getAttribute("data-testid");
      const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 36);
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ""} "${text}"`;
    };
    const rendered = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      if (el.closest('[aria-hidden="true"], [inert], details:not([open]) > :not(summary)')) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none";
    };
    const scrolls = (v: string) => v === "auto" || v === "scroll";
    const root = document.documentElement;
    const rootScrolls =
      root.scrollHeight > vh + 1 && !["hidden", "clip"].includes(getComputedStyle(root).overflowY) && !["hidden", "clip"].includes(getComputedStyle(document.body).overflowY);
    const selector = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=radio], [role=menuitem]";
    for (const el of document.querySelectorAll(selector)) {
      if (!rendered(el) || (el as HTMLInputElement).disabled) continue;
      let { left, top, right, bottom } = el.getBoundingClientRect();
      let lost: string | null = null;
      let fixed = getComputedStyle(el).position === "fixed";
      for (let p = el.parentElement; p && p !== root && !lost; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.position === "fixed") fixed = true;
        if (s.overflowX === "visible" && s.overflowY === "visible") continue;
        const b = p.getBoundingClientRect();
        const outY = top < b.top - 1 || bottom > b.bottom + 1;
        const outX = left < b.left - 1 || right > b.right + 1;
        if (outY && !scrolls(s.overflowY)) lost = `cut off by ${describe(p)} (${Math.round(bottom)} > ${Math.round(b.bottom)})`;
        else if (outX && !scrolls(s.overflowX)) lost = `cut off sideways by ${describe(p)}`;
        else if (outY || outX) {
          // reachable by scrolling this region: from here on it sits where the region does
          top = Math.max(b.top, Math.min(top, b.bottom - 1));
          bottom = Math.min(b.bottom, Math.max(bottom, b.top + 1));
          left = Math.max(b.left, Math.min(left, b.right - 1));
          right = Math.min(b.right, Math.max(right, b.left + 1));
        }
      }
      if (!lost) {
        const outsideWindow = top < -1 || left < -1 || bottom > vh + 1 || right > vw + 1;
        if (outsideWindow && !(rootScrolls && !fixed && left >= -1 && right <= vw + 1)) {
          lost = `outside the window (top ${Math.round(top)}, bottom ${Math.round(bottom)}, right ${Math.round(right)} in ${vw}x${vh})`;
        }
      }
      if (lost) findings.push({ key: "unreachable", detail: `${describe(el)} ${lost}` });
    }
    return findings;
  });
}
