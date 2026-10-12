import { describe, expect, it } from "vitest";
import type {
  CashMovementType,
  OrderStatus,
  PaymentMethod,
  POSStationTicket,
  ServiceType,
  ShiftStatus,
} from "./posContracts";
import {
  businessDayWords,
  cashMovementWords,
  clockTime,
  orderStatusTone,
  orderStatusWords,
  paymentMethodWords,
  serviceTypeWords,
  shiftChipWords,
  shiftStatusWords,
  shiftWords,
  ticketNextStepWords,
  ticketStepWords,
} from "./words";

const ORDER_STATUSES: OrderStatus[] = ["OPEN", "SENT", "PREPARING", "READY", "SERVED", "CLOSED", "VOIDED"];
const TICKET_STEPS: POSStationTicket["status"][] = ["SENT", "PREPARING", "READY", "SERVED"];
const METHODS: (PaymentMethod | "ROOM_CHARGE")[] = [
  "CASH",
  "MOBILE_MONEY",
  "BANK_TRANSFER",
  "EXTERNAL_CARD",
  "ROOM_CHARGE",
  "OTHER",
];
const MOVEMENTS: CashMovementType[] = ["CASH_IN", "CASH_OUT"];
const SERVICE_TYPES: ServiceType[] = ["DINE_IN", "TAKEAWAY", "ROOM_SERVICE"];
const SHIFT_STATUSES: ShiftStatus[] = ["OPEN", "PENDING_VARIANCE_APPROVAL", "CLOSED"];

/** A code leaking onto a screen: capitals joined by underscores. */
const CODE = /\b[A-Z]{2,}(?:_[A-Z]+)*\b/;

function expectPlain(word: string, code: string) {
  expect(word, code).toBeTruthy();
  expect(word, code).not.toBe(code);
  expect(word, code).not.toMatch(CODE);
  expect(word, code).not.toContain("_");
}

describe("plain words for backend codes", () => {
  it("says every order status in words", () => {
    expect(ORDER_STATUSES.map(orderStatusWords)).toEqual([
      "Open",
      "Sent to kitchen",
      "Preparing",
      "Ready",
      "Served",
      "Paid",
      "Voided",
    ]);
    ORDER_STATUSES.forEach((status) => expectPlain(orderStatusWords(status), status));
  });

  it("gives every order status a tone so a chip never relies on colour alone", () => {
    expect(orderStatusTone("READY")).toBe("success");
    expect(orderStatusTone("CLOSED")).toBe("success");
    expect(orderStatusTone("VOIDED")).toBe("danger");
    expect(orderStatusTone("PREPARING")).toBe("warning");
    expect(orderStatusTone("OPEN")).toBe("neutral");
  });

  it("names the kitchen ticket steps and the next step on each", () => {
    expect(TICKET_STEPS.map(ticketStepWords)).toEqual(["New", "Preparing", "Ready", "Served"]);
    expect(TICKET_STEPS.map(ticketNextStepWords)).toEqual(["Start", "Ready", "Served", null]);
  });

  it("names every payment method, including room charge", () => {
    expect(METHODS.map(paymentMethodWords)).toEqual([
      "Cash",
      "Mobile money",
      "Bank transfer",
      "Card (own machine)",
      "Charge to room",
      "Other",
    ]);
    METHODS.forEach((method) => expectPlain(paymentMethodWords(method), method));
  });

  it("names cash movements, service types and shift states", () => {
    expect(MOVEMENTS.map(cashMovementWords)).toEqual(["Cash in", "Cash out"]);
    expect(SERVICE_TYPES.map(serviceTypeWords)).toEqual(["Dine in", "Takeaway", "Room service"]);
    expect(SHIFT_STATUSES.map(shiftStatusWords)).toEqual([
      "Open",
      "Waiting for a supervisor to approve the count",
      "Closed",
    ]);
  });

  it("never prints a code it does not know", () => {
    const unknown = "SOMETHING_NEW" as OrderStatus;
    expectPlain(orderStatusWords(unknown), unknown);
    expectPlain(paymentMethodWords("CRYPTO_WALLET" as PaymentMethod), "CRYPTO_WALLET");
    expectPlain(serviceTypeWords("DELIVERY" as ServiceType), "DELIVERY");
    expectPlain(cashMovementWords("CASH_DROP" as CashMovementType), "CASH_DROP");
    expectPlain(ticketStepWords("BUMPED" as POSStationTicket["status"]), "BUMPED");
    expect(orderStatusTone(unknown)).toBe("neutral");
  });
});

describe("time in words", () => {
  it("shows a 24-hour clock time, and nothing for a missing one", () => {
    expect(clockTime(undefined)).toBe("");
    expect(clockTime(new Date(2026, 9, 12, 7, 2))).toBe("07:02");
    expect(clockTime(new Date(2026, 9, 12, 19, 45))).toBe("19:45");
  });

  it("says when the shift opened", () => {
    expect(shiftWords({ status: "OPEN", openedAt: new Date(2026, 9, 12, 7, 2).toISOString() })).toBe(
      "Shift open since 07:02",
    );
    expect(shiftWords(null)).toBe("No shift open");
    expect(shiftWords({ status: "PENDING_VARIANCE_APPROVAL", openedAt: "2026-10-12T04:02:00Z" })).toBe(
      "Shift waiting for a supervisor",
    );
    expect(shiftWords({ status: "OPEN", openedAt: "not a time" })).toBe("Shift open");
  });
});

describe("the business day in words", () => {
  it("writes the business day as people say it, never as a machine date", () => {
    expect(businessDayWords("2026-10-12")).toBe("Mon 12 Oct");
    expect(businessDayWords("2026-01-01")).toBe("Thu 1 Jan");
    expect(businessDayWords("2026-12-31")).toBe("Thu 31 Dec");
  });

  it("reads the day as that calendar day, not a moment shifted by the time zone", () => {
    expect(businessDayWords("2026-10-12")).toBe("Mon 12 Oct");
  });

  it("shows nothing rather than a date it cannot read", () => {
    expect(businessDayWords(undefined)).toBe("");
    expect(businessDayWords("")).toBe("");
    expect(businessDayWords("12/10/2026")).toBe("");
    expect(businessDayWords("2026-13-40")).toBe("");
  });

  it("puts the shift and its business day in the top bar chip, with a shorter form", () => {
    const opened = new Date(2026, 9, 12, 7, 2).toISOString();
    expect(shiftChipWords({ status: "OPEN", openedAt: opened, businessDate: "2026-10-12" })).toEqual({
      full: "Shift open since 07:02 · Mon 12 Oct",
      short: "Since 07:02 · Mon 12 Oct",
    });
    expect(shiftChipWords({ status: "OPEN", openedAt: opened, businessDate: "not a day" })).toEqual({
      full: "Shift open since 07:02",
      short: "Since 07:02",
    });
    expect(shiftChipWords(null)).toEqual({ full: "No shift open", short: "No shift open" });
    expect(
      shiftChipWords({ status: "PENDING_VARIANCE_APPROVAL", openedAt: opened, businessDate: "2026-10-12" }),
    ).toEqual({ full: "Shift waiting for a supervisor · Mon 12 Oct", short: "Waiting for a supervisor · Mon 12 Oct" });
  });
});
