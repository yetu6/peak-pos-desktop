import { afterEach, describe, expect, it } from "vitest";
import {
  DISPLAY_SCALE_COMPACT,
  DISPLAY_SCALE_LARGE,
  DISPLAY_SIZE_KEY,
  autoScale,
  clampScale,
  describeDisplay,
  displayKeyAction,
  displaySetting,
  parseDisplaySetting,
  scaleFor,
  setDisplaySetting,
  stepScale,
} from "./displaySize";

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.style.zoom = "";
});

describe("Display size: automatic scale", () => {
  it("is 1 when the window is the reference size or bigger", () => {
    expect(autoScale(1280, 800)).toBe(1);
    expect(autoScale(1920, 1080)).toBe(1);
  });
  it("shrinks to the tighter side", () => {
    expect(autoScale(1024, 768)).toBe(0.8);
    expect(autoScale(1366, 600)).toBe(0.75);
    expect(autoScale(1100, 800)).toBe(0.86);
  });
  it("never goes below the floor or above the ceiling", () => {
    expect(autoScale(600, 400)).toBe(0.75);
    expect(clampScale(3)).toBe(1.25);
    expect(clampScale(0.1)).toBe(0.75);
  });
  it("ignores a window with no size", () => {
    expect(autoScale(0, 0)).toBe(1);
  });
});

describe("Display size: the setting", () => {
  it("maps the named choices to their named scales", () => {
    expect(scaleFor("compact", 1024, 600)).toBe(DISPLAY_SCALE_COMPACT);
    expect(scaleFor("standard", 1024, 600)).toBe(1);
    expect(scaleFor("large", 1024, 600)).toBe(DISPLAY_SCALE_LARGE);
    expect(scaleFor("auto", 1024, 600)).toBe(0.75);
    expect(scaleFor(0.9, 1024, 600)).toBe(0.9);
  });
  it("steps by 0.05 inside the limits", () => {
    expect(stepScale(1, 1)).toBe(1.05);
    expect(stepScale(1, -1)).toBe(0.95);
    expect(stepScale(1.25, 1)).toBe(1.25);
    expect(stepScale(0.75, -1)).toBe(0.75);
    expect(stepScale(0.85, 1)).toBe(0.9);
  });
  it("reads what was stored, and falls back to Automatic", () => {
    expect(parseDisplaySetting(null)).toBe("auto");
    expect(parseDisplaySetting("nonsense")).toBe("auto");
    expect(parseDisplaySetting("")).toBe("auto");
    expect(parseDisplaySetting("large")).toBe("large");
    expect(parseDisplaySetting("1.1")).toBe(1.1);
    expect(parseDisplaySetting("9")).toBe(1.25);
  });
  it("is saved on this computer and read back", () => {
    expect(displaySetting()).toBe("auto");
    setDisplaySetting("compact");
    expect(window.localStorage.getItem(DISPLAY_SIZE_KEY)).toBe("compact");
    expect(displaySetting()).toBe("compact");
    setDisplaySetting(1.1);
    expect(displaySetting()).toBe(1.1);
  });
  it("applies the scale to the page in a browser", () => {
    setDisplaySetting("compact");
    expect(document.documentElement.style.zoom).toBe("0.85");
    setDisplaySetting("standard");
    expect(document.documentElement.style.zoom).toBe("");
  });
  it("says it in plain words", () => {
    expect(describeDisplay("auto", 0.8)).toBe("Automatic, 80%");
    expect(describeDisplay(1.05, 1.05)).toBe("Manual, 105%");
  });
});

describe("Display size: keys", () => {
  const key = (k: string, extra = {}) => displayKeyAction({ key: k, ctrlKey: true, metaKey: false, altKey: false, ...extra });
  it("reads Ctrl + / Ctrl - / Ctrl 0", () => {
    expect(key("+")).toBe("bigger");
    expect(key("=")).toBe("bigger");
    expect(key("-")).toBe("smaller");
    expect(key("0")).toBe("reset");
  });
  it("leaves other keys alone", () => {
    expect(key("+", { ctrlKey: false })).toBeNull();
    expect(key("a")).toBeNull();
    expect(key("0", { altKey: true })).toBeNull();
  });
});
