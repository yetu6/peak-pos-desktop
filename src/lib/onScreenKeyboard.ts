import { useSyncExternalStore } from "react";

/**
 * Named setting: the on-screen keyboard (owner, 2026-10-29: every input works by
 * touch alone). Automatic shows it on a till with touch until a physical key is
 * pressed; Always and Off are the manager's choice. Kept on this computer.
 */
export type KeyboardMode = "auto" | "always" | "off";
export const DEFAULT_KEYBOARD_MODE: KeyboardMode = "auto";
export const KEYBOARD_MODE_KEY = "yetu.onScreenKeyboard";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function keyboardMode(): KeyboardMode {
  try {
    const stored = window.localStorage.getItem(KEYBOARD_MODE_KEY);
    return stored === "always" || stored === "off" || stored === "auto" ? stored : DEFAULT_KEYBOARD_MODE;
  } catch {
    return DEFAULT_KEYBOARD_MODE;
  }
}

export function setKeyboardMode(mode: KeyboardMode) {
  try {
    window.localStorage.setItem(KEYBOARD_MODE_KEY, mode);
  } catch {
    // Not stored: it applies until the till restarts.
  }
  memory = mode;
  notify();
}

let memory: KeyboardMode | null = null;
export function useKeyboardMode(): KeyboardMode {
  return useSyncExternalStore(subscribe, () => {
    const stored = keyboardMode();
    return stored === DEFAULT_KEYBOARD_MODE && memory ? memory : stored;
  });
}

// What this session has seen: a touch, a physical key. A physical key hides the
// keyboard in Automatic until the till is next started.
let physicalKeySeen = false;
let touchSeen = false;
let watching = false;

export function resetKeyboardSession() {
  physicalKeySeen = false;
  touchSeen = false;
  memory = null;
  notify();
}

export function startWatchingInput() {
  if (watching || typeof window === "undefined") return () => {};
  watching = true;
  const onKey = () => {
    if (!physicalKeySeen) {
      physicalKeySeen = true;
      notify();
    }
  };
  const onPointer = (event: PointerEvent) => {
    if (event.pointerType === "touch" && !touchSeen) {
      touchSeen = true;
      notify();
    }
  };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onPointer, true);
  return () => {
    watching = false;
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointerdown", onPointer, true);
  };
}

function coarsePointer(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/** Whether the keyboard may show now, by the setting and what this session has seen. */
export function keyboardAllowed(mode: KeyboardMode): boolean {
  if (mode === "off") return false;
  if (mode === "always") return true;
  return (coarsePointer() || touchSeen) && !physicalKeySeen;
}

export function useKeyboardAllowed(): boolean {
  const mode = useKeyboardMode();
  return useSyncExternalStore(subscribe, () => keyboardAllowed(mode));
}
