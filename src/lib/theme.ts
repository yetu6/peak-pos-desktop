import { useSyncExternalStore } from "react";
import { DEFAULT_THEME_BEFORE_PAIRING, THEME_CANVAS, defaultThemeForMode, normalizeMode, type Theme } from "./displayDefaults";

export type { Theme } from "./displayDefaults";

/**
 * The per-device theme. Only a choice a person makes with the theme switch is
 * stored as a choice. A device nobody has chosen for follows its paired mode's
 * default (`displayDefaults.ts`): Light for tills, Dark for kitchen and bar
 * displays. That default is remembered separately, so the next start paints
 * it before the mode has loaded (public/theme-boot.js runs before the app).
 * The body classes are the ones the till has always used (`light-theme`, or
 * `dark-theme` plus `dark` for the `dark:` utilities).
 */
export const THEME_CHOICE_KEY = "yetu-till-theme";
export const MODE_THEME_KEY = "yetu-till-mode-theme";
/**
 * The old key. The old switch wrote it on every start (with Dark as the
 * default), so its value is no evidence that anyone chose: it is ignored and
 * removed.
 */
export const LEGACY_THEME_KEY = "peak-pos-theme";

let current: Theme = "light";
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readTheme(key: string): Theme | null {
  try {
    const value = storage()?.getItem(key);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function writeTheme(key: string, theme: Theme): void {
  try {
    storage()?.setItem(key, theme);
  } catch {
    // A till that cannot store still shows the theme; it just won't remember it.
  }
}

/** The theme a person chose on this device, if any. */
export function storedTheme(): Theme | null {
  return readTheme(THEME_CHOICE_KEY);
}

export function resolveTheme(stored: Theme | null, mode?: string | null): Theme {
  return stored ?? defaultThemeForMode(mode);
}

export function currentTheme(): Theme {
  return current;
}

/** Puts a theme on screen without remembering it. */
export function applyTheme(theme: Theme): void {
  current = theme;
  if (typeof document !== "undefined") {
    const body = document.body;
    body.classList.toggle("dark-theme", theme === "dark");
    body.classList.toggle("dark", theme === "dark");
    body.classList.toggle("light-theme", theme === "light");
    document.documentElement.style.backgroundColor = THEME_CANVAS[theme];
    document.documentElement.style.colorScheme = theme;
  }
  for (const listener of listeners) listener();
}

/** A person chose a theme on this device: remember it and show it. */
export function chooseTheme(theme: Theme): void {
  writeTheme(THEME_CHOICE_KEY, theme);
  applyTheme(theme);
}

/** At start-up, before the till knows its mode: the choice, else the last mode default. */
export function bootTheme(): void {
  try {
    storage()?.removeItem(LEGACY_THEME_KEY);
  } catch {
    // nothing to clean up
  }
  applyTheme(storedTheme() ?? readTheme(MODE_THEME_KEY) ?? DEFAULT_THEME_BEFORE_PAIRING);
}

/**
 * Once the paired mode is known: remember its default for the next start and
 * follow it unless a person chose. While the mode is still unknown, keep the
 * remembered default.
 */
export function applyModeDefaultTheme(mode?: string | null): void {
  let modeTheme = readTheme(MODE_THEME_KEY);
  if (normalizeMode(mode)) {
    modeTheme = defaultThemeForMode(mode);
    writeTheme(MODE_THEME_KEY, modeTheme);
  }
  applyTheme(storedTheme() ?? modeTheme ?? DEFAULT_THEME_BEFORE_PAIRING);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): { theme: Theme; choose: (theme: Theme) => void; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, currentTheme);
  return {
    theme,
    choose: chooseTheme,
    toggle: () => chooseTheme(currentTheme() === "dark" ? "light" : "dark"),
  };
}
