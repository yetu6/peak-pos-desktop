/**
 * The till's global keys. Each works anywhere in the shell, including while a
 * field has focus, and each is shown on screen beside what it does. Keys for
 * a single screen (Sell, Pay) belong to that screen, not here. Esc closes the
 * top sheet through the sheet itself.
 */
import type { WorkspacePage } from "./workspace";

export type GlobalCommand =
  | { kind: "navigate"; page: WorkspacePage }
  | { kind: "lock" }
  | { kind: "command-search" };

export interface KeyBinding {
  /** As shown on screen. */
  keys: string;
  command: GlobalCommand;
}

export const GLOBAL_KEYS: readonly KeyBinding[] = [
  { keys: "F1", command: { kind: "navigate", page: "new" } },
  { keys: "F2", command: { kind: "navigate", page: "orders" } },
  { keys: "F3", command: { kind: "navigate", page: "kitchen" } },
  { keys: "F4", command: { kind: "navigate", page: "manager" } },
  { keys: "F12", command: { kind: "navigate", page: "status" } },
  { keys: "Ctrl+L", command: { kind: "lock" } },
  { keys: "Ctrl+K", command: { kind: "command-search" } },
];

type KeyInput = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

export function globalCommandFor(event: KeyInput): GlobalCommand | null {
  if (event.altKey || event.shiftKey) return null;
  const control = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const pressed = control ? `Ctrl+${key}` : key;
  if (!control && !/^F\d{1,2}$/.test(key)) return null;
  return GLOBAL_KEYS.find((binding) => binding.keys === pressed)?.command ?? null;
}

export function keyHintFor(page: WorkspacePage): string | undefined {
  return GLOBAL_KEYS.find((binding) => binding.command.kind === "navigate" && binding.command.page === page)?.keys;
}

export function keyHintForCommand(kind: Exclude<GlobalCommand["kind"], "navigate">): string | undefined {
  return GLOBAL_KEYS.find((binding) => binding.command.kind === kind)?.keys;
}
