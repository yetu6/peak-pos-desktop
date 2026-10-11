import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_THEME_BY_MODE, DEFAULT_THEME_BEFORE_PAIRING, defaultThemeForMode } from "./displayDefaults";
import {
  THEME_STORAGE_KEY,
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

beforeEach(() => {
  localStorage.clear();
  document.body.className = "";
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

  it("keeps the existing storage key and ignores values it does not know", () => {
    expect(THEME_STORAGE_KEY).toBe("peak-pos-theme");
    localStorage.setItem("peak-pos-theme", "dark");
    expect(storedTheme()).toBe("dark");
    localStorage.setItem("peak-pos-theme", "blue");
    expect(storedTheme()).toBeNull();
  });

  it("sets the same body classes the till has always used", () => {
    applyTheme("dark");
    expect(bodyClasses()).toEqual(["dark", "dark-theme"]);
    expect(currentTheme()).toBe("dark");
    applyTheme("light");
    expect(bodyClasses()).toEqual(["light-theme"]);
    expect(currentTheme()).toBe("light");
  });

  it("stores only a choice a person made, never a default", () => {
    bootTheme();
    expect(bodyClasses()).toEqual(["light-theme"]);
    applyModeDefaultTheme("KITCHEN_DISPLAY");
    expect(bodyClasses()).toEqual(["dark", "dark-theme"]);
    expect(localStorage.getItem("peak-pos-theme")).toBeNull();

    chooseTheme("light");
    expect(localStorage.getItem("peak-pos-theme")).toBe("light");
    expect(bodyClasses()).toEqual(["light-theme"]);
  });

  it("does not let the mode default override a person's choice", () => {
    chooseTheme("light");
    applyModeDefaultTheme("KITCHEN_DISPLAY");
    expect(bodyClasses()).toEqual(["light-theme"]);
  });

  it("starts from the stored choice at boot", () => {
    localStorage.setItem("peak-pos-theme", "dark");
    bootTheme();
    expect(bodyClasses()).toEqual(["dark", "dark-theme"]);
  });
});
