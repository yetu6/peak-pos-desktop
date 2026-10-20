import { afterEach, describe, expect, it } from "vitest";
import { clearOperationalSession, setOperationalSession } from "../lib/operationalSession";
import { workspaceNav } from "../lib/workspace";
import { copyNotPrintedWords, PRINTERS_PLACE, printProblemOnce } from "./printProblems";

function signIn(token: string) {
  setOperationalSession({
    token,
    expiresAt: "2099-01-01T00:00:00Z",
    tenantId: "tenant-1",
    propertyId: "property-1",
    outletId: "outlet-1",
    terminalId: "terminal-1",
    staffId: "staff-1",
    assurance: "RESTRICTED",
  });
}

// F-233: Bahari QA Hotel has no printer; every send and payment failed to print, and the till said nothing.
describe("printProblemOnce", () => {
  afterEach(() => clearOperationalSession());

  it("says once for each person signed in what didn't print and why; a print that worked says nothing", () => {
    signIn("zawadi-session");
    expect(printProblemOnce([{ ok: true }], "kitchen ticket")).toBeNull();
    const failed = [{ ok: true }, { ok: false, error: "No printer is set up on this till" }];
    expect(printProblemOnce(failed, "kitchen ticket")).toBe(
      "The kitchen ticket didn't print: no printer is set up on this till. A manager sets up printers in Status (F12), under Printers.",
    );
    expect(printProblemOnce(failed, "kitchen ticket")).toBeNull();
    // A bill is its own thing to say.
    expect(printProblemOnce(failed, "bill")).toBe(
      "The bill didn't print: no printer is set up on this till. A manager sets up printers in Status (F12), under Printers.",
    );
    // The next person to sign in is told too.
    signIn("baraka-session");
    expect(printProblemOnce(failed, "kitchen ticket")).not.toBeNull();
  });

  // F-246: the words sent managers to "Manager, Printers", a page the till doesn't have.
  it("sends a manager to a page every till has", () => {
    const page = PRINTERS_PLACE.split(" (")[0];
    for (const mode of ["POS", "CASHIER", "KITCHEN_DISPLAY", "OFFLINE_CASH"]) {
      expect(workspaceNav(mode).map((item) => item.label)).toContain(page);
    }
  });

  it("a copy that didn't print says why and that Yetu has the receipt", () => {
    expect(copyNotPrintedWords("Print failed: printer out of paper.")).toBe(
      "The copy didn't print: print failed: printer out of paper. Yetu has the bill; try again once the printer is ready.",
    );
  });
});
