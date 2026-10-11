import { describe, expect, it } from "vitest";
import { defaultWorkspacePage, railNav, workspaceNav } from "./workspace";

describe("railNav", () => {
  it("names the sections in staff words, Sell first", () => {
    expect(railNav("POS").map((item) => [item.page, item.label])).toEqual([
      ["new", "Sell"],
      ["orders", "Orders"],
      ["kitchen", "Kitchen"],
      ["manager", "Cash"],
      ["status", "Status"],
    ]);
    expect(railNav("POS").every((item) => item.disabledReason === undefined)).toBe(true);
  });

  it("keeps the mode's own filter: a cashier till has no Kitchen at all", () => {
    expect(railNav("CASHIER").map((item) => item.page)).toEqual(["new", "orders", "manager", "status"]);
  });

  it("keeps a kitchen or bar display to its tickets and status", () => {
    expect(railNav("KITCHEN_DISPLAY").map((item) => item.page)).toEqual(["kitchen", "status"]);
    expect(railNav("bar-display").map((item) => item.page)).toEqual(["kitchen", "status"]);
  });

  it("working offline keeps every position and says why a section is closed", () => {
    const rail = railNav("POS", { offlineCash: true });
    expect(rail.map((item) => item.page)).toEqual(["new", "orders", "kitchen", "manager", "status"]);
    const closed = rail.filter((item) => item.disabledReason);
    expect(closed.map((item) => item.page)).toEqual(["orders", "kitchen", "manager"]);
    for (const item of closed) {
      expect(item.disabledReason).toMatch(/connection/i);
    }
    expect(rail.find((item) => item.page === "new")?.disabledReason).toBeUndefined();
    expect(rail.find((item) => item.page === "status")?.disabledReason).toBeUndefined();
  });

  it("a cashier till working offline still has no Kitchen", () => {
    expect(railNav("CASHIER", { offlineCash: true }).map((item) => item.page)).toEqual([
      "new",
      "orders",
      "manager",
      "status",
    ]);
  });

  it("enables exactly the sections the existing workspace allows", () => {
    const cases: Array<[string, boolean[]]> = [
      ["POS", [false, true]],
      ["CASHIER", [false, true]],
      // A display has no rail, so working offline there changes nothing on it.
      ["KITCHEN_DISPLAY", [false]],
      ["BAR_DISPLAY", [false]],
    ];
    for (const [mode, offlineStates] of cases) {
      for (const offlineCash of offlineStates) {
        const allowed = workspaceNav(offlineCash ? "offline-cash" : mode).map((item) => item.page).sort();
        const enabled = railNav(mode, { offlineCash })
          .filter((item) => !item.disabledReason)
          .map((item) => item.page)
          .sort();
        expect(enabled, `${mode} offline=${offlineCash}`).toEqual(allowed);
      }
    }
  });
});

describe("workspaceNav", () => {
  it("gives a POS till the register, new order, kitchen, manager, and status", () => {
    expect(workspaceNav("POS").map((item) => item.page)).toEqual([
      "orders",
      "new",
      "kitchen",
      "manager",
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
      "manager",
      "status",
    ]);
    expect(workspaceNav("offline-cash").map((item) => item.page)).toEqual([
      "new",
      "status",
    ]);
    expect(defaultWorkspacePage("offline-cash")).toBe("new");
  });
});
