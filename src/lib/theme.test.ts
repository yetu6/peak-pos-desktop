import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_BY_MODE,
  DEFAULT_THEME_BEFORE_PAIRING,
  THEME_CANVAS,
  defaultThemeForMode,
} from "./displayDefaults";
import {
  LEGACY_THEME_KEY,
  MODE_THEME_KEY,
  THEME_CHOICE_KEY,
  applyModeDefaultTheme,
  applyTheme,
  bootTheme,
  chooseTheme,
  currentTheme,
  resolveTheme,
  storedTheme,
} from "./theme";

function bodyClasses(): string[] {
  return [...document.body.classList].sort();
}

function hexToRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

beforeEach(() => {
  localStorage.clear();
  document.body.className = "";
  document.documentElement.style.backgroundColor = "";
});

afterEach(() => {
  localStorage.clear();
  document.body.className = "";
});

describe("display defaults (named setting)", () => {
  it("starts a selling till in Light and a kitchen or bar display in Dark", () => {
    expect(defaultThemeForMode("POS")).toBe("light");
    expect(defaultThemeForMode("CASHIER")).toBe("light");
    expect(defaultThemeForMode("KITCHEN_DISPLAY")).toBe("dark");
    expect(defaultThemeForMode("BAR_DISPLAY")).toBe("dark");
  });

  it("reads the mode the way the pairing record writes it", () => {
    expect(defaultThemeForMode("kitchen-display")).toBe("dark");
    expect(defaultThemeForMode(" bar_display ")).toBe("dark");
    expect(defaultThemeForMode("cashier")).toBe("light");
  });

  it("uses the before-pairing default when the mode is not known yet", () => {
    expect(defaultThemeForMode(undefined)).toBe(DEFAULT_THEME_BEFORE_PAIRING);
    expect(defaultThemeForMode(null)).toBe(DEFAULT_THEME_BEFORE_PAIRING);
    expect(defaultThemeForMode("SOMETHING_NEW")).toBe(DEFAULT_THEME_BEFORE_PAIRING);
    expect(DEFAULT_THEME_BEFORE_PAIRING).toBe("light");
  });

  it("names every paired mode in the setting", () => {
    expect(Object.keys(DEFAULT_THEME_BY_MODE).sort()).toEqual(
      ["BAR_DISPLAY", "CASHIER", "KITCHEN_DISPLAY", "POS"],
    );
  });
});

describe("theme preference", () => {
  it("lets a stored choice win over the mode default", () => {
    expect(resolveTheme("dark", "POS")).toBe("dark");
    expect(resolveTheme("light", "KITCHEN_DISPLAY")).toBe("light");
    expect(resolveTheme(null, "KITCHEN_DISPLAY")).toBe("dark");
    expect(resolveTheme(null, "POS")).toBe("light");
  });

  it("keeps a person's choice under its own key and ignores values it does not know", () => {
    expect(THEME_CHOICE_KEY).toBe("yetu-till-theme");
    localStorage.setItem("yetu-till-theme", "dark");
    expect(storedTheme()).toBe("dark");
    localStorage.setItem("yetu-till-theme", "blue");
    expect(storedTheme()).toBeNull();
  });

  it("does not take the old key as a choice: the old switch wrote it on every start", () => {
    expect(LEGACY_THEME_KEY).toBe("peak-pos-theme");
    localStorage.setItem("peak-pos-theme", "dark");
    expect(storedTheme()).toBeNull();
    bootTheme();
    expect(bodyClasses()).toEqual(["light-theme"]);
    expect(localStorage.getItem("peak-pos-theme")).toBeNull();
  });

  it("starts a selling till with an old dark value in its mode default, Light", () => {
    for (const mode of ["POS", "CASHIER"]) {
      localStorage.clear();
      localStorage.setItem("peak-pos-theme", "dark");
      bootTheme();
      applyModeDefaultTheme(mode);
      expect(bodyClasses(), mode).toEqual(["light-theme"]);
    }
  });

  it("sets the same body classes the till has always used, and paints the page behind them", () => {
    applyTheme("dark");
    expect(bodyClasses()).toEqual(["dark", "dark-theme"]);
    expect(currentTheme()).toBe("dark");
    expect(document.documentElement.style.backgroundColor).toBe(hexToRgb(THEME_CANVAS.dark));
    applyTheme("light");
    expect(bodyClasses()).toEqual(["light-theme"]);
    expect(currentTheme()).toBe("light");
    expect(document.documentElement.style.backgroundColor).toBe(hexToRgb(THEME_CANVAS.light));
  });

  it("stores only a choice a person made as a choice", () => {
    bootTheme();
    expect(bodyClasses()).toEqual(["light-theme"]);
    applyModeDefaultTheme("KITCHEN_DISPLAY");
    expect(bodyClasses()).toEqual(["dark", "dark-theme"]);
    expect(localStorage.getItem("yetu-till-theme")).toBeNull();

    chooseTheme("light");
    expect(localStorage.getItem("yetu-till-theme")).toBe("light");
    expect(localStorage.getItem("peak-pos-theme")).toBeNull();
    expect(bodyClasses()).toEqual(["light-theme"]);
  });

  it("remembers the mode's default apart from the choice, so the next start paints it first", () => {
    expect(MODE_THEME_KEY).toBe("yetu-till-mode-theme");
    applyModeDefaultTheme("KITCHEN_DISPLAY");
    expect(localStorage.getItem("yetu-till-mode-theme")).toBe("dark");
    document.body.className = "";
    bootTheme();
    expect(bodyClasses()).toEqual(["dark", "dark-theme"]);
  });

  it("does not forget the mode's default while the mode is still loading", () => {
    applyModeDefaultTheme("BAR_DISPLAY");
    applyModeDefaultTheme(undefined);
    expect(localStorage.getItem("yetu-till-mode-theme")).toBe("dark");
    expect(bodyClasses()).toEqual(["dark", "dark-theme"]);
  });

  it("lets a person's choice win at start over the remembered mode default", () => {
    localStorage.setItem("yetu-till-mode-theme", "dark");
    localStorage.setItem("yetu-till-theme", "light");
    bootTheme();
    expect(bodyClasses()).toEqual(["light-theme"]);
  });

  it("does not let the mode default override a person's choice", () => {
    chooseTheme("light");
    applyModeDefaultTheme("KITCHEN_DISPLAY");
    expect(bodyClasses()).toEqual(["light-theme"]);
  });

  it("starts from the stored choice at boot", () => {
    localStorage.setItem("yetu-till-theme", "dark");
    bootTheme();
    expect(bodyClasses()).toEqual(["dark", "dark-theme"]);
  });
});
