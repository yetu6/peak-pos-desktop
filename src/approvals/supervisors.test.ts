import { describe, expect, it } from "vitest";
import { noApproverWords, supervisorsFor } from "./supervisors";

// F-249: the void sheet at Bahari offered Zawadi, a cashier; Yetu refused her twice.
describe("who an approval sheet offers", () => {
  const roster = [
    { staffNumber: "baraka", fullName: "Baraka Mushi" },
    { staffNumber: "neema", fullName: "Neema Mwakyusa" },
    { staffNumber: "zawadi", fullName: "Zawadi Said" },
  ];
  const approvers = [
    { staffId: "baraka", approves: ["DISCOUNT", "VOID"] as const },
    { staffId: "neema", approves: ["REFUND"] as const },
  ].map((a) => ({ ...a, approves: [...a.approves] }));

  it("only those Yetu says can approve this kind", () => {
    expect(supervisorsFor(roster, approvers, "VOID").map((p) => p.name)).toEqual(["Baraka Mushi"]);
    expect(supervisorsFor(roster, approvers, "REFUND").map((p) => p.name)).toEqual(["Neema Mwakyusa"]);
    expect(supervisorsFor(roster, approvers, "CASH_OUT")).toEqual([]);
  });

  it("everyone, as before, until Yetu has answered", () => {
    expect(supervisorsFor(roster, null, "VOID").map((p) => p.name)).toEqual(["Baraka Mushi", "Neema Mwakyusa", "Zawadi Said"]);
  });

  it("says who chooses when no one may approve", () => {
    expect(noApproverWords("CASH_OUT")).toBe("No one is set to approve cash-outs here yet. The owner chooses in Team rules.");
  });
});
