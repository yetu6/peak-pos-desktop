import { describe, expect, it } from "vitest";
import { defaultWorkspacePage, workspaceNav } from "./workspace";

describe("workspaceNav", () => {
  it("gives a POS till the register, new order, kitchen, and status", () => {
    expect(workspaceNav("POS").map((item) => item.page)).toEqual([
      "orders",
      "new",
      "kitchen",
      "status",
    ]);
  });

  it("keeps a kitchen or bar display on tickets plus status", () => {
    expect(workspaceNav("KITCHEN_DISPLAY").map((item) => item.page)).toEqual([
      "kitchen",
      "status",
    ]);
    expect(workspaceNav("BAR_DISPLAY").map((item) => item.page)).toEqual([
      "kitchen",
      "status",
    ]);
    expect(defaultWorkspacePage("kitchen-display")).toBe("kitchen");
  });

  it("does not put a cashier on a kitchen display they cannot work", () => {
    expect(workspaceNav("cashier").map((item) => item.page)).toEqual([
      "orders",
      "new",
      "status",
    ]);
  });
});
