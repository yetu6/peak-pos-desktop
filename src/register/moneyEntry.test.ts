import { describe, expect, it } from "vitest";
import { keyedOver, typedOver } from "./moneyEntry";

describe("typing over an amount the till filled in", () => {
  it("keeps only what was typed, as the browser says it was typed", () => {
    // The field selected, "4" typed: the browser's input says "4", though the
    // amount began with 4 too.
    expect(typedOver("42500", "4", true, { inputType: "insertText", data: "4" })).toBe("4");
    expect(typedOver("42500", "42,000", true, { inputType: "insertFromPaste", data: "42,000" })).toBe("42000");
  });

  it("a deletion clears it, as the keypad's does", () => {
    expect(typedOver("42500", "4250", true, { inputType: "deleteContentBackward", data: null })).toBe("");
  });

  it("without the browser's account, keeps what was typed wherever the caret was", () => {
    expect(typedOver("42500", "4250020000", true)).toBe("20000"); // at the end
    expect(typedOver("42500", "425500", true)).toBe("5"); // in the middle: never 425,500
    expect(typedOver("42500", "542500", true)).toBe("5"); // at the start: never 542,500
  });

  it("once the cashier has typed, edits are theirs", () => {
    expect(typedOver("20000", "200000", false, { inputType: "insertText", data: "0" })).toBe("200000");
  });
});

describe("the keypad over an amount the till filled in", () => {
  it("the first key replaces it, and Delete clears it", () => {
    expect(keyedOver("42500", "5", true)).toBe("5");
    expect(keyedOver("42500", "delete", true)).toBe("");
    expect(keyedOver("42500", "00", true)).toBe("");
    expect(keyedOver("5", "0", false)).toBe("50");
  });
});
