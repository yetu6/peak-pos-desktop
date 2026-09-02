import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(`${process.cwd()}/src/index.css`, "utf8");
const tauriConfig = JSON.parse(
  readFileSync(`${process.cwd()}/src-tauri/tauri.conf.json`, "utf8"),
) as { app: { windows: Array<Record<string, unknown>> } };

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function token(name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"));
  if (!match) throw new Error(`Missing color token ${name}`);
  return match[1];
}

describe("Peak Terminal foundation", () => {
  it("defines the locked semantic palette", () => {
    for (const token of [
      "--color-background",
      "--color-surface",
      "--color-surface-raised",
      "--color-surface-interactive",
      "--color-border",
      "--color-foreground",
      "--color-foreground-muted",
      "--color-primary",
      "--color-primary-hover",
      "--color-gold-accent",
      "--color-warning",
      "--color-danger",
      "--color-success",
      "--color-focus",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("removes the previous glass and gradient visual language", () => {
    expect(css).not.toMatch(/backdrop-filter\s*:/);
    expect(css).not.toMatch(/(?:linear|radial)-gradient\s*\(/);
  });

  it("declares touch, keyboard focus, and reduced-motion foundations", () => {
    expect(css).toMatch(/--control-height:\s*48px/);
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("keeps core dark-terminal text and status pairs at WCAG AA contrast", () => {
    for (const [foreground, background] of [
      ["--foreground", "--background"],
      ["--foreground-muted", "--background"],
      ["--primary-foreground", "--primary"],
      ["--focus", "--background"],
      ["--success", "--success-subtle"],
      ["--warning", "--warning-subtle"],
      ["--danger", "--danger-subtle"],
      ["--offline", "--warning-subtle"],
    ]) {
      expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("enforces the minimum supported Tauri viewport", () => {
    expect(tauriConfig.app.windows[0]).toMatchObject({
      minWidth: 1024,
      minHeight: 768,
    });
  });
});
