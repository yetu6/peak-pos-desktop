import { describe, expect, it } from "vitest";
import { defaultWorkspacePage, workspaceNav } from "./workspace";

describe("workspaceNav", () => {
  it("gives a POS till the register, new order, and kitchen", () => {
    expect(workspaceNav("POS").map((item) => item.page)).toEqual([
      "orders",
      "new",
      "kitchen",
    ]);
  });

  it("keeps a kitchen or bar display on tickets only", () => {
    expect(workspaceNav("KITCHEN_DISPLAY").map((item) => item.page)).toEqual(["kitchen"]);
    expect(workspaceNav("BAR_DISPLAY").map((item) => item.page)).toEqual(["kitchen"]);
    expect(defaultWorkspacePage("kitchen-display")).toBe("kitchen");
  });

  it("does not put a cashier on a kitchen display they cannot work", () => {
    expect(workspaceNav("cashier").map((item) => item.page)).toEqual(["orders", "new"]);
  });
});
