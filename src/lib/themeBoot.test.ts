import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_CANVAS } from "./displayDefaults";
import { LEGACY_THEME_KEY, MODE_THEME_KEY, THEME_CHOICE_KEY, bootTheme } from "./theme";

/**
 * public/theme-boot.js runs before the app's own code and before the first
 * paint, so a kitchen display never flashes Light and a Dark till never
 * flashes white. It must reach the same theme as `bootTheme()`.
 */
const root = process.cwd();
const bootScript = readFileSync(join(root, "public/theme-boot.js"), "utf8");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");

function runBootScript(): void {
  // A classic script in the page's global scope, as the browser runs it.
  new Function(bootScript)();
}

function snapshot() {
  return {
    classes: [...document.body.classList].sort(),
    background: document.documentElement.style.backgroundColor,
    scheme: document.documentElement.style.colorScheme,
  };
}

function reset(storage: Record<string, string>) {
  localStorage.clear();
  for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
  document.body.className = "";
  document.documentElement.removeAttribute("style");
}

const STATES: Array<[string, Record<string, string>, "light" | "dark"]> = [
  ["a new device", {}, "light"],
  ["a person chose Dark", { [THEME_CHOICE_KEY]: "dark" }, "dark"],
  ["a person chose Light", { [THEME_CHOICE_KEY]: "light" }, "light"],
  ["a kitchen display nobody chose for", { [MODE_THEME_KEY]: "dark" }, "dark"],
  ["a kitchen display where a person chose Light", { [MODE_THEME_KEY]: "dark", [THEME_CHOICE_KEY]: "light" }, "light"],
  ["a till with only the old key", { [LEGACY_THEME_KEY]: "dark" }, "light"],
  ["values it does not know", { [THEME_CHOICE_KEY]: "blue", [MODE_THEME_KEY]: "sepia" }, "light"],
];

beforeEach(() => reset({}));
afterEach(() => reset({}));

describe("theme boot script", () => {
  for (const [name, storage, theme] of STATES) {
    it(`paints ${theme} first for ${name}, as the app will`, () => {
      reset(storage);
      runBootScript();
      const fromScript = snapshot();
      expect(fromScript.classes).toEqual(theme === "dark" ? ["dark", "dark-theme"] : ["light-theme"]);
      expect(fromScript.scheme).toBe(theme);
      expect(fromScript.background).not.toBe("");

      reset(storage);
      bootTheme();
      expect(snapshot()).toEqual(fromScript);
    });
  }

  it("removes the old key, which never recorded a choice", () => {
    reset({ [LEGACY_THEME_KEY]: "dark" });
    runBootScript();
    expect(localStorage.getItem(LEGACY_THEME_KEY)).toBeNull();
  });

  it("still paints Light when storage cannot be read", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage is off");
      },
    });
    try {
      expect(() => runBootScript()).not.toThrow();
      expect(snapshot().classes).toEqual(["light-theme"]);
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });

  it("uses the canvas colours the tokens use", () => {
    expect(bootScript).toContain(THEME_CANVAS.light);
    expect(bootScript).toContain(THEME_CANVAS.dark);
  });

  it("is loaded by index.html as a blocking script before the app", () => {
    const boot = indexHtml.indexOf('<script src="/theme-boot.js"></script>');
    const app = indexHtml.indexOf('<script type="module" src="/src/main.tsx">');
    expect(boot).toBeGreaterThan(indexHtml.indexOf("<body>"));
    expect(boot).toBeGreaterThan(-1);
    expect(boot).toBeLessThan(indexHtml.indexOf('<div id="root">'));
    expect(boot).toBeLessThan(app);
  });
});
