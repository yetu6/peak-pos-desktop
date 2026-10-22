import { describe, expect, it } from "vitest";
import { readable } from "./escpos";
import { kitchenTicketBytes } from "./kitchenTicket";
import { paperFromPrintDocument } from "./kitchenRouting";
import { formatKitchenTicket } from "../lib/kitchenTicketPrint";
import { formatReceipt, receiptCopyFromPrintDocument } from "../lib/receiptPrint";
import { receiptBytes } from "./receipt";
import { settingsFrom, stationCopiesFor } from "./printerSettings";

const document = { station: "BAR", dailyNumber: 6, orderNumber: "POS-BAR-6", roundNumber: 2, copy: true,
  printedAgainByName: "Amina", printedAgainAt: "2026-10-22T10:52:00Z", items: [
    { name: "Coffee", quantity: 1, fulfilment: "PREPARED" },
    { name: "Water", quantity: 2, fulfilment: "PICKED" },
    { name: "Counter snack", quantity: 1, fulfilment: "DIRECT" },
  ] };

describe("W5 production layouts", () => {
  it.each([32, 48] as const)("groups hand over before make, excludes direct, preserves audit at %s", width => {
    const text = readable(kitchenTicketBytes(paperFromPrintDocument(document), width));
    expect(text).toContain("BAR ORDER");
    expect(text).toContain("ORDER 6 - ROUND 2 - ADDED");
    expect(text.indexOf("HAND OVER")).toBeLessThan(text.indexOf("MAKE"));
    expect(text).toContain("2 x Water");
    expect(text).not.toContain("Counter snack");
    expect(text).toContain("by Amina");
    expect(text).toContain("13:52");
    expect(text).not.toContain("POS-BAR-6");
  });
  it("emits no bytes for an entirely direct round", () => {
    expect(kitchenTicketBytes(paperFromPrintDocument({ items: [document.items[2]] }), 48)).toHaveLength(0);
  });
  it("system formatter has the same grouping and audit", () => {
    const text = formatKitchenTicket({ station: "BAR", dailyNumber: 6, orderNumber: "POS-BAR-6", roundNumber: 2,
      copy: true, printedAgainByName: "Amina", printedAgainAt: document.printedAgainAt,
      lines: document.items.map(row => ({ ...row, fulfilment: row.fulfilment as "PREPARED" | "PICKED" | "DIRECT", quantity: String(row.quantity) })) });
    expect(text).toContain("ROUND 2 · ADDED");
    expect(text).toContain("COPY");
    expect(text).toContain("Amina");
    expect(text).toContain("13:52");
    expect(text).not.toContain("Ref POS-BAR-6");
    expect(text.indexOf("HAND OVER")).toBeLessThan(text.indexOf("MAKE"));
    expect(text).not.toContain("Counter snack");
  });
  it("quantity emphasis can be switched off independently", () => {
    const ticket = paperFromPrintDocument(document);
    const encoded = (bold: boolean, large: boolean) => Array.from(kitchenTicketBytes(ticket, 48, { quantityBold: bold, quantityLarge: large })).join(",");
    const water = Array.from(new TextEncoder().encode("2 x Water")).join(",");
    expect(encoded(false, false)).toContain(`27,69,0,29,33,0,${water}`);
    expect(encoded(true, false)).toContain(`27,69,1,29,33,0,${water}`);
    expect(encoded(false, true)).toContain(`27,69,0,29,33,1,${water}`);
  });
});

it("settings preserve legacy width, defaults and validated station copies", () => {
  expect(settingsFrom({}).quantityBold).toBe(true);
  expect(settingsFrom({}).quantityLarge).toBe(true);
  expect(settingsFrom({ quantityBold: false, quantityLarge: false })).toMatchObject({ quantityBold: false, quantityLarge: false });
  expect(settingsFrom({ receipt: { target: { kind: "system", name: "Printer" } } }).receipt?.width).toBe(32);
  expect(settingsFrom({ receipt: { target: { kind: "system", name: "Printer" }, billLogo: true } }).receipt?.billLogo).toBe(true);
  expect(stationCopiesFor(settingsFrom({ stationCopies: { BAR: 3, HOT: 0, COLD: 1.5 } }), "BAR")).toBe(3);
  expect(stationCopiesFor(settingsFrom({ stationCopies: { BAR: 0 } }), "BAR")).toBe(1);
  expect(stationCopiesFor(settingsFrom({}), "HOT")).toBe(1);
});

it("both bill paths retain the business name and reprint audit with the owner’s signature and without copy drawer kicks", () => {
  const receipt = receiptCopyFromPrintDocument({ kind: "BILL", propertyName: "Bahari QA Hotel", dailyNumber: 6,
    orderNumber: "POS-BAR-6", copy: true, printedAgainByName: "Amina", printedAgainAt: document.printedAgainAt, items: [] });
  for (const text of [formatReceipt(receipt), readable(receiptBytes(receipt, 48, { copy: true, drawer: true }))]) {
    expect(text).toContain("BAHARI QA HOTEL");
    expect(text).toContain("COPY");
    expect(text).toContain("Amina");
    expect(text).toContain("13:52");
    expect(text).toContain("Ref POS-BAR-6");
    expect(text).toContain("Powered by Yetu-FBC");
  }
  expect(Array.from(receiptBytes(receipt, 48, { copy: true, drawer: true })).join(",")).not.toContain("27,112,0,25,250");
});

it("rejects excessive, fractional and unsafe station copies", () => {
  for (const count of [0, -1, 4, 1.5, Infinity, NaN, "3"]) {
    const settings = settingsFrom({ stationCopies: { BAR: count } });
    expect(stationCopiesFor(settings, "BAR")).toBe(1);
    expect(settings.stationCopies?.BAR).toBeUndefined();
  }
});
it("missing fulfilment remains prepared and empty groups do not print", () => {
  const text = readable(kitchenTicketBytes(paperFromPrintDocument({ items: [{ name: "Soup", quantity: 1 }] }), 32));
  expect(text).toContain("MAKE\n");
  expect(text).not.toContain("HAND OVER");
  expect(text).toContain("*** END - 1 ITEM ***");
  expect(kitchenTicketBytes({ lines: [] }, 48)).toHaveLength(0);
});
it("production defaults to bold and double-height quantities", () => {
  const bytes = Array.from(kitchenTicketBytes(paperFromPrintDocument(document), 48)).join(",");
  expect(bytes).toContain(`27,69,1,29,33,1,${Array.from(new TextEncoder().encode("2 x Water")).join(",")}`);
});

it.each([32, 48] as const)("prints business contact details once on both bill paths at %s", width => {
  const copy = receiptCopyFromPrintDocument({ kind: "BILL", propertyName: "Bahari QA Hotel",
    propertyAddress: "Dar es Salaam", propertyPhone: "+255 700 123 456", items: [] });
  for (const text of [formatReceipt(copy), readable(receiptBytes(copy, width))]) {
    expect(text).toContain("Dar es Salaam");
    expect(text).toContain("+255 700 123 456");
    expect(text.match(/Powered by Yetu-FBC/g)).toHaveLength(1);
    expect(text).toContain("BAHARI QA HOTEL");
  }
});
it.each([32, 48] as const)("resets footer typography to normal size, centered and bold at %s", width => {
  const bytes = receiptBytes({ propertyName: "Bahari QA Hotel", beforePayment: true, lines: [] }, width);
  const signature = Array.from(new TextEncoder().encode("Powered by Yetu-FBC"));
  expect(Array.from(bytes).join(",")).toContain([29,33,0,27,97,1,27,69,1,...signature,10,27,69,0,27,100,3,29,86,66,3].join(","));
});
it.each([32, 48] as const)("maps backend address/phone and labels item, quantity and amount columns at %s", width => {
  const copy = receiptCopyFromPrintDocument({ kind: "BILL", propertyName: "Bahari QA Hotel", address: "Dar es Salaam", phone: "+255 700 123 456",
    items: [{ name: "Coffee", quantity: 2, totalMinor: 1000000 }], currency: "TZS" });
  expect(copy).toMatchObject({ propertyAddress: "Dar es Salaam", propertyPhone: "+255 700 123 456" });
  for (const text of [formatReceipt(copy), readable(receiptBytes(copy, width))]) {
    expect(text).toMatch(/ITEM\s+QTY\s+AMOUNT/);
    expect(text).toContain("Dar es Salaam");
    expect(text).toContain("+255 700 123 456");
    expect(text).toContain("TSh 10,000");
  }
});
