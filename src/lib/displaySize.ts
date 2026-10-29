import { useSyncExternalStore } from "react";
import { isTauriRuntime } from "./peakSocket";

/**
 * Named setting: the display size (owner, 2026-10-29: on a small till screen the bottom of
 * some screens was hidden). Automatic fits the window to the 1280 x 800 layout the screens
 * are designed on; Compact, Standard and Large are fixed; Ctrl + / Ctrl - / Ctrl 0 and the
 * A- / A+ buttons in Status set a manual value. Kept on this computer.
 *
 * One way only: inside the app the whole webview is zoomed (Tauri's setZoom, which the
 * window-level permission `core:webview:allow-set-webview-zoom` allows). In a browser
 * (the preview and the visual checks) the same scale is applied as CSS zoom on the page.
 */
export const DISPLAY_REFERENCE_WIDTH = 1280;
export const DISPLAY_REFERENCE_HEIGHT = 800;
export const DISPLAY_SCALE_MIN = 0.75;
export const DISPLAY_SCALE_MAX = 1.25;
export const DISPLAY_SCALE_STEP = 0.05;
export const DISPLAY_SCALE_COMPACT = 0.85;
export const DISPLAY_SCALE_STANDARD = 1;
export const DISPLAY_SCALE_LARGE = 1.15;
export const DISPLAY_SIZE_KEY = "yetu.displaySize";

export type DisplayChoice = "auto" | "compact" | "standard" | "large";
/** A named choice, or a manual scale (set with the keys or the A- / A+ buttons). */
export type DisplaySetting = DisplayChoice | number;
export const DEFAULT_DISPLAY_SETTING: DisplaySetting = "auto";

const round = (value: number) => Math.round(value * 100) / 100;
export const clampScale = (value: number) => round(Math.min(DISPLAY_SCALE_MAX, Math.max(DISPLAY_SCALE_MIN, value)));

/** The scale that makes the reference layout fit a window of this size (CSS pixels at zoom 1). */
export function autoScale(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return DISPLAY_SCALE_STANDARD;
  return clampScale(Math.min(1, width / DISPLAY_REFERENCE_WIDTH, height / DISPLAY_REFERENCE_HEIGHT));
}

export function scaleFor(setting: DisplaySetting, width: number, height: number): number {
  if (typeof setting === "number") return clampScale(setting);
  switch (setting) {
    case "compact":
      return DISPLAY_SCALE_COMPACT;
    case "standard":
      return DISPLAY_SCALE_STANDARD;
    case "large":
      return DISPLAY_SCALE_LARGE;
    default:
      return autoScale(width, height);
  }
}

/** One step bigger (+1) or smaller (-1) from a scale, kept inside the limits. */
export function stepScale(current: number, direction: 1 | -1): number {
  return clampScale(current + direction * DISPLAY_SCALE_STEP);
}

export function parseDisplaySetting(raw: string | null): DisplaySetting {
  if (raw === "auto" || raw === "compact" || raw === "standard" || raw === "large") return raw;
  const number = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isFinite(number) ? clampScale(number) : DEFAULT_DISPLAY_SETTING;
}

/** Plain words for a setting, shown in Status. */
export function describeDisplay(setting: DisplaySetting, scale: number): string {
  const percent = `${Math.round(scale * 100)}%`;
  if (typeof setting === "number") return `Manual, ${percent}`;
  const name = { auto: "Automatic", compact: "Compact", standard: "Standard", large: "Large" }[setting];
  return `${name}, ${percent}`;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

let memory: DisplaySetting | null = null;

export function displaySetting(): DisplaySetting {
  try {
    return parseDisplaySetting(window.localStorage.getItem(DISPLAY_SIZE_KEY));
  } catch {
    return memory ?? DEFAULT_DISPLAY_SETTING;
  }
}

export function setDisplaySetting(setting: DisplaySetting) {
  memory = setting;
  try {
    window.localStorage.setItem(DISPLAY_SIZE_KEY, String(setting));
  } catch {
    // Not stored: it applies until the till restarts.
  }
  applyDisplay();
  notify();
}

// The scale on screen now, and how it is applied.
let applied = DISPLAY_SCALE_STANDARD;
let appliedNative = false;

/** The window's size in CSS pixels at zoom 1 (the webview reports it already divided by its zoom). */
function baseSize(): { width: number; height: number } {
  const zoom = appliedNative ? applied : 1;
  return { width: window.innerWidth * zoom, height: window.innerHeight * zoom };
}

export function currentScale(): number {
  const { width, height } = baseSize();
  return scaleFor(displaySetting(), width, height);
}

async function setNativeZoom(scale: number): Promise<boolean> {
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(scale);
    return true;
  } catch {
    return false;
  }
}

function applyCssZoom(scale: number) {
  const root = document.documentElement;
  root.style.zoom = scale === 1 ? "" : String(scale);
  // Heights written as 100dvh are zoomed with the page; give them the window's real height.
  root.style.setProperty("--yetu-zoom", String(scale));
}

let pending = 0;
export function applyDisplay() {
  if (typeof window === "undefined") return;
  const scale = currentScale();
  if (scale === applied && (appliedNative || !isTauriRuntime())) {
    notify();
    return;
  }
  const token = ++pending;
  if (isTauriRuntime()) {
    void setNativeZoom(scale).then((ok) => {
      if (token !== pending) return;
      if (ok) {
        applied = scale;
        appliedNative = true;
      } else {
        // The webview refused: scale the page instead, never both.
        applied = scale;
        appliedNative = false;
        applyCssZoom(scale);
      }
      notify();
    });
    return;
  }
  applied = scale;
  appliedNative = false;
  applyCssZoom(scale);
  notify();
}

/** Keys: Ctrl + (or =) bigger, Ctrl - smaller, Ctrl 0 back to Standard. */
export function displayKeyAction(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): "bigger" | "smaller" | "reset" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (event.key === "+" || event.key === "=") return "bigger";
  if (event.key === "-" || event.key === "_") return "smaller";
  if (event.key === "0") return "reset";
  return null;
}

export function biggerDisplay() {
  setDisplaySetting(stepScale(currentScale(), 1));
}
export function smallerDisplay() {
  setDisplaySetting(stepScale(currentScale(), -1));
}
export function resetDisplay() {
  setDisplaySetting(DISPLAY_SCALE_STANDARD === 1 ? "standard" : DEFAULT_DISPLAY_SETTING);
}

let started = false;
/** Called once at start-up: applies the saved setting, follows the window's size and the zoom keys. */
export function startDisplaySize(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;
  applyDisplay();
  const onResize = () => {
    if (displaySetting() === "auto") applyDisplay();
  };
  const onKey = (event: KeyboardEvent) => {
    const action = displayKeyAction(event);
    if (!action) return;
    event.preventDefault();
    if (action === "bigger") biggerDisplay();
    else if (action === "smaller") smallerDisplay();
    else resetDisplay();
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKey);
  return () => {
    started = false;
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKey);
  };
}

export function useDisplaySetting(): { setting: DisplaySetting; scale: number } {
  const setting = useSyncExternalStore(subscribe, () => String(displaySetting()));
  const scale = useSyncExternalStore(subscribe, () => applied);
  return { setting: parseDisplaySetting(setting), scale };
}
