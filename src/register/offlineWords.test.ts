import { describe, expect, it } from "vitest";
import { offlineProblemWords } from "./offlineWords";

/** Every kind the Rust store can refuse with (src-tauri local_store/mod.rs LocalStoreErrorKind). */
const KINDS = [
  "MISSING_KEY",
  "SECURE_STORE_UNAVAILABLE",
  "INVALID_KEY_ENVELOPE",
  "KEY_MISMATCH",
  "CORRUPTION",
  "MIGRATION_FAILURE",
  "DISK_FULL",
  "INTEGRITY_FAILURE",
  "AUTHORIZATION_REQUIRED",
  "INVALID_AUTHORIZATION",
  "AUTHORIZATION_ROLLBACK",
  "INVALID_CATALOG",
  "CATALOG_REQUIRED",
  "INVALID_ORDER",
  "STALE_DRAFT",
  "OPERATION_NOT_ALLOWED",
  "LIMIT_EXCEEDED",
  "SIGNING_FAILURE",
];

describe("the offline store's refusals in words", () => {
  it.each(KINDS)("%s: what it means, that nothing was saved, and what to do", (kind) => {
    const words = offlineProblemWords(kind, "sale");
    expect(words).toContain("The sale wasn't saved.");
    expect(words).not.toContain(kind);
    expect(words).not.toMatch(/Something went wrong/);
    expect(words).toMatch(/\.$/);
  });

  it("covers every kind the Rust store has", async () => {
    const { readFileSync } = await import("node:fs");
    const rust = readFileSync("src-tauri/src/local_store/mod.rs", "utf-8");
    const block = /pub enum LocalStoreErrorKind \{([^}]*)\}/.exec(rust)![1];
    const names = block.match(/[A-Z][A-Za-z]+/g)!.map((name) => name.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase());
    expect(names.sort()).toEqual([...KINDS].sort());
  });

  it("something unknown says nothing was saved and to try again, never the raw text", () => {
    expect(offlineProblemWords(new Error("boom: sqlite"), "add")).toBe("Something went wrong on this till. The item wasn't added. Try again.");
  });
});
