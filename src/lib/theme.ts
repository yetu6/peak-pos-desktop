import { useSyncExternalStore } from "react";
import { defaultThemeForMode, type Theme } from "./displayDefaults";

export type { Theme } from "./displayDefaults";

/**
 * The per-device theme preference. The key and the body classes are the ones
 * the till has always used (`peak-pos-theme`; `light-theme`, or `dark-theme`
 * plus `dark` for the `dark:` utilities). Only a choice a person makes is
 * stored: a device nobody has chosen for follows its mode's default
 * (`displayDefaults.ts`), so a kitchen display stays Dark and a till Light.
 */
export const THEME_STORAGE_KEY = "peak-pos-theme";

let current: Theme = "light";
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function storedTheme(): Theme | null {
  const value = storage()?.getItem(THEME_STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
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
    document.documentElement.style.colorScheme = theme;
  }
  for (const listener of listeners) listener();
}

/** A person chose a theme on this device: remember it and show it. */
export function chooseTheme(theme: Theme): void {
  storage()?.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}

/** At start-up, before the till knows its mode. */
export function bootTheme(): void {
  applyTheme(resolveTheme(storedTheme(), null));
}

/** Once the paired mode is known: follow its default unless a person chose. */
export function applyModeDefaultTheme(mode?: string | null): void {
  applyTheme(resolveTheme(storedTheme(), mode));
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
