import { describe, expect, it } from "vitest";
import { GLOBAL_KEYS, globalCommandFor, keyHintFor } from "./keyboard";

function key(init: Partial<Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">>) {
  return { key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init };
}

describe("global keys", () => {
  it("moves between the till's sections with function keys", () => {
    expect(globalCommandFor(key({ key: "F1" }))).toEqual({ kind: "navigate", page: "new" });
    expect(globalCommandFor(key({ key: "F2" }))).toEqual({ kind: "navigate", page: "orders" });
    expect(globalCommandFor(key({ key: "F3" }))).toEqual({ kind: "navigate", page: "kitchen" });
    expect(globalCommandFor(key({ key: "F4" }))).toEqual({ kind: "navigate", page: "manager" });
    expect(globalCommandFor(key({ key: "F12" }))).toEqual({ kind: "navigate", page: "status" });
  });

  it("locks with Ctrl+L and opens the command search with Ctrl+K", () => {
    expect(globalCommandFor(key({ key: "l", ctrlKey: true }))).toEqual({ kind: "lock" });
    expect(globalCommandFor(key({ key: "L", ctrlKey: true }))).toEqual({ kind: "lock" });
    expect(globalCommandFor(key({ key: "k", ctrlKey: true }))).toEqual({ kind: "command-search" });
    expect(globalCommandFor(key({ key: "k", metaKey: true }))).toEqual({ kind: "command-search" });
  });

  it("leaves ordinary typing and the system's own keys alone", () => {
    expect(globalCommandFor(key({ key: "l" }))).toBeNull();
    expect(globalCommandFor(key({ key: "k" }))).toBeNull();
    expect(globalCommandFor(key({ key: "F5" }))).toBeNull();
    expect(globalCommandFor(key({ key: "F4", altKey: true }))).toBeNull();
    expect(globalCommandFor(key({ key: "F1", shiftKey: true }))).toBeNull();
    expect(globalCommandFor(key({ key: "l", ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(globalCommandFor(key({ key: "Escape" }))).toBeNull();
  });

  it("shows the key next to each section and never binds one key twice", () => {
    expect(keyHintFor("new")).toBe("F1");
    expect(keyHintFor("orders")).toBe("F2");
    expect(keyHintFor("kitchen")).toBe("F3");
    expect(keyHintFor("manager")).toBe("F4");
    expect(keyHintFor("status")).toBe("F12");
    const keys = GLOBAL_KEYS.map((binding) => binding.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
