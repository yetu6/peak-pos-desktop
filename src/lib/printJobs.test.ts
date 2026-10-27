import { afterEach, describe, expect, it, vi } from "vitest";
import { formatPrintDocument, processPendingPrintJobs, ticketCopyFromPrintDocument } from "./printJobs";
import type { POSPrintJob } from "./posContracts";
import { dateTimeWords } from "./words";

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const KITCHEN_JOB: POSPrintJob = {
  id: "job-1",
  sourceType: "POS_ORDER",
  sourceId: "order-1",
  jobType: "KITCHEN_TICKET",
  status: "PENDING",
  attempts: 0,
  createdAt: "2026-08-29T10:00:00Z",
  document: { ticketNumber: "KDS-1", orderNumber: "POS-1", items: [{ id: "i1", name: "Stew", quantity: 1 }] },
};

describe("printJobs: the order's number for the day (S5b)", () => {
  it("a kitchen ticket says the number the kitchen calls out, not the reference", () => {
    const formatted = formatPrintDocument({
      ...KITCHEN_JOB,
      document: { orderNumber: "POS-MR-261012-42", dailyNumber: 42, station: "GRILL", items: [{ id: "i1", name: "Stew", quantity: 1 }] },
    });
    expect(formatted.text).toContain("Order 42");
    expect(formatted.text).not.toContain("POS-MR-261012-42");
  });

  it("a receipt says the number, with the reference beside it for finding it again", () => {
    const formatted = formatPrintDocument({
      ...KITCHEN_JOB,
      id: "job-r",
      jobType: "RECEIPT",
      document: { orderNumber: "POS-MR-261012-42", dailyNumber: 42, totalMinor: 2360, items: [{ name: "Stew", quantity: 1, totalMinor: 2360 }] },
    });
    expect(formatted.text).toContain("Order 42");
    expect(formatted.text).toContain("Ref POS-MR-261012-42");
  });

  it("a receipt made before S5b (no number) goes by its reference", () => {
    const formatted = formatPrintDocument({ ...KITCHEN_JOB, id: "job-r", jobType: "RECEIPT", document: { orderNumber: "POS-a3f90c14", items: [] } });
    expect(formatted.text).toContain("Order POS-a3f90c14");
    expect(formatted.text).not.toContain("Ref ");
  });
});

// Yetu's own receipt document, field for field as internal/pos/receipts.go
// (ReceiptDocument, ReceiptLine) writes it: money in minor units beside the
// currency, the time as an instant, the method as a code.
const YETU_RECEIPT: POSPrintJob = {
  ...KITCHEN_JOB,
  id: "job-r",
  sourceId: "order-7",
  jobType: "RECEIPT",
  document: {
    orderId: "order-7",
    orderNumber: "POS-a3f90c14",
    dailyNumber: 7,
    businessDate: "2026-10-18",
    propertyName: "Jacaranda B&B",
    outletName: "Garden Restaurant",
    initiatedByName: "Amina Juma",
    operatorName: "Amina Juma",
    serviceType: "DINE_IN",
    tableLabel: "4",
    items: [
      { name: "Chips", quantity: 2, unitPriceMinor: 500_000, taxMinor: 180_000, totalMinor: 1_180_000 },
      { name: "Soda", quantity: 1, unitPriceMinor: 150_000, taxMinor: 27_000, totalMinor: 177_000 },
    ],
    subtotalMinor: 1_150_000,
    taxMinor: 207_000,
    totalMinor: 1_357_000,
    currency: "TZS",
    tenderMethod: "MOBILE_MONEY",
    settledAt: "2026-10-18T14:05:00Z",
  },
};

describe("printJobs: Yetu's receipt as a guest reads it", () => {
  it("prints money as money, never the minor units Yetu sends", () => {
    const { text } = formatPrintDocument(YETU_RECEIPT);
    // VAT on top: each line without its VAT, so the lines (10,000 + 1,500) add up to the Subtotal under them.
    expect(text).toContain("TSh 10,000");
    expect(text).toContain("TSh 1,500");
    expect(text).not.toContain("TSh 11,800");
    expect(text).toContain("Subtotal  TSh 11,500");
    expect(text).toContain("VAT  TSh 2,070");
    expect(text).toContain("TOTAL  TSh 13,570");
    expect(text).not.toMatch(/1180000|1357000|207000/);
  });

  it("says how it was paid and when, in words", () => {
    const { text } = formatPrintDocument(YETU_RECEIPT);
    expect(text).toContain("Mobile money");
    expect(text).not.toContain("MOBILE");
    expect(text).toContain(`Paid ${dateTimeWords("2026-10-18T14:05:00Z")}`);
    expect(text).not.toContain("2026-10-18T14:05:00Z");
  });
});

// Yetu's refund receipt document, as internal/pos/refunds.go
// (RefundReceiptDocument) writes it.
const YETU_REFUND_RECEIPT: POSPrintJob = {
  ...KITCHEN_JOB,
  id: "job-refund",
  sourceType: "POS_REFUND",
  sourceId: "refund-1",
  jobType: "REFUND_RECEIPT",
  document: {
    refundId: "refund-1",
    orderId: "order-7",
    orderNumber: "POS-a3f90c14",
    dailyNumber: 7,
    businessDate: "2026-10-18",
    propertyName: "Jacaranda B&B",
    outletName: "Garden Restaurant",
    lines: [
      { id: "rl-1", orderItemId: "oi-1", name: "Chips", quantity: 1, grossMinor: 500_000, discountMinor: 0, netMinor: 500_000, taxMinor: 90_000, totalMinor: 590_000 },
    ],
    netMinor: 500_000,
    discountMinor: 0,
    taxMinor: 90_000,
    totalMinor: 590_000,
    currency: "TZS",
    tenders: [{ paymentMethod: "CASH", amountMinor: 590_000 }],
    reason: "Cold when served",
    initiatedByName: "Amina Juma",
    authorizedByName: "Baraka Mushi",
    refundedAt: "2026-10-18T15:40:00Z",
  },
};

describe("printJobs: a refund receipt", () => {
  it("is its own slip, never a kitchen ticket", () => {
    const formatted = formatPrintDocument(YETU_REFUND_RECEIPT);
    expect(formatted.title).toBe("yetu-refund-receipt");
    expect(formatted.text).toContain("REFUND");
    expect(formatted.text).toContain("Jacaranda B&B".toUpperCase());
    expect(formatted.text).toContain("Order 7");
    expect(formatted.text).toContain("Ref POS-a3f90c14");
  });

  it("says what was given back, how, why, and who asked and approved", () => {
    const { text } = formatPrintDocument(YETU_REFUND_RECEIPT);
    expect(text).toMatch(/1 {2}Chips {2}TSh 5,900/);
    expect(text).toContain("Given back  TSh 5,900");
    expect(text).toContain("VAT included  TSh 900");
    expect(text).toContain("Cash  TSh 5,900");
    expect(text).toContain("Reason: Cold when served");
    expect(text).toContain("Asked by Amina Juma");
    expect(text).toContain("Approved by Baraka Mushi");
    expect(text).toContain(dateTimeWords("2026-10-18T15:40:00Z"));
    expect(text).not.toMatch(/590000|CASH|2026-10-18T/);
  });

  it("names a room charge refund as taken off the room's bill", () => {
    const { text } = formatPrintDocument({
      ...YETU_REFUND_RECEIPT,
      document: { ...YETU_REFUND_RECEIPT.document, tenders: [{ paymentMethod: "ROOM_CHARGE", amountMinor: 590_000 }] },
    });
    expect(text).toContain("Taken off the room bill  TSh 5,900");
  });

  it("shows the discount share when the order had a discount", () => {
    const { text } = formatPrintDocument({
      ...YETU_REFUND_RECEIPT,
      document: { ...YETU_REFUND_RECEIPT.document, discountMinor: 50_000, netMinor: 450_000, taxMinor: 81_000, totalMinor: 531_000 },
    });
    expect(text).toContain("Less the order's discount  TSh 500");
  });
});

describe("printJobs", () => {
  it("formats a Peak kitchen ticket without prices", () => {
    const copy = ticketCopyFromPrintDocument(KITCHEN_JOB.document);
    const formatted = formatPrintDocument(KITCHEN_JOB);
    expect(copy.lines[0]?.name).toBe("Stew");
    expect(formatted.title).toBe("yetu-kitchen-ticket");
    expect(formatted.text).toContain("KDS-1");
    expect(formatted.text).toContain("POS-1");
    expect(formatted.text).not.toMatch(/tax|TSh|price/i);
  });

  it("formats Peak's own receipt document with the posted totals", () => {
    const formatted = formatPrintDocument({
      ...KITCHEN_JOB,
      id: "job-r",
      jobType: "RECEIPT",
      document: {
        orderNumber: "POS-1",
        tableLabel: "12",
        tenderMethod: "CASH",
        subtotal: "20.00",
        taxAmount: "3.60",
        totalAmount: "23.60",
        lines: [{ name: "Stew", quantity: "2", unitPrice: "10.00", total: "23.60" }],
      },
    });
    expect(formatted.title).toBe("yetu-bill");
    // A paid order's bill, printed again on request (2026-10-20); nothing about TRA on it (the owner).
    expect(formatted.text).toContain("BILL - PAID");
    expect(formatted.text).not.toContain("INVOICE");
    expect(formatted.text).not.toMatch(/TRA|tax receipt/);
    expect(formatted.text).toContain("POS-1");
    expect(formatted.text).toContain("TOTAL  23.60");
    expect(formatted.text).toContain("VAT  3.60");
  });

  it("falls back to the generic ticket formatter for an unrecognized job type instead of dropping it", () => {
    const formatted = formatPrintDocument({ ...KITCHEN_JOB, jobType: "SOMETHING_NEW" });
    expect(formatted.title).toBe("yetu-something-new");
    expect(formatted.text).toContain("KDS-1");
  });

  it("filters PENDING jobs with the exact uppercase status Peak's column stores", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.endsWith("/claim")) return json({ ...KITCHEN_JOB, status: "CLAIMED" });
        if (url.endsWith("/printed")) return json({ ...KITCHEN_JOB, status: "PRINTED" });
        if (url.includes("/pos/print-jobs")) return json([KITCHEN_JOB]);
        return json({}, 500);
      }),
    );

    const printed: string[] = [];
    const results = await processPendingPrintJobs("prop", "order-1", async (title, text) => {
      printed.push(`${title}\n${text}`);
    });
    expect(requestedUrls[0]).toContain("status=PENDING");
    // S8a: only this order's jobs, however many others wait at the outlet.
    expect(requestedUrls[0]).toContain("sourceId=order-1");
    expect(results).toMatchObject([{ ok: true }]);
    expect(printed[0]).toContain("POS-1");
  });

  it("acks failed when the local printer throws and does not pretend the send failed at Peak", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.endsWith("/claim")) return json({ ...KITCHEN_JOB, status: "CLAIMED" });
        if (url.endsWith("/failed")) return json({ ...KITCHEN_JOB, status: "FAILED" });
        if (url.includes("/pos/print-jobs")) return json([KITCHEN_JOB]);
        return json({}, 500);
      }),
    );

    const results = await processPendingPrintJobs("prop", "order-1", async () => {
      throw new Error("No printer is set up on this till");
    });
    expect(results).toMatchObject([{ ok: false, error: "No printer is set up on this till" }]);
  });

  // YQA-10: a job still PENDING on a later poll -- because the previous
  // claim's response was lost, not because the claim never reached the
  // server -- must retry with the SAME Idempotency-Key. A fresh random one
  // per call looks like an unrelated new claim, not a retry.
  it("retrying the same still-PENDING job across polls reuses the claim's Idempotency-Key", async () => {
    const claimKeys: (string | null)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/claim")) {
          claimKeys.push(new Headers(init?.headers).get("Idempotency-Key"));
          return json({ ...KITCHEN_JOB, status: "CLAIMED" });
        }
        if (url.endsWith("/printed")) return json({ ...KITCHEN_JOB, status: "PRINTED" });
        if (url.includes("/pos/print-jobs")) return json([KITCHEN_JOB]);
        return json({}, 500);
      }),
    );

    await processPendingPrintJobs("prop", "order-1", async () => {});
    await processPendingPrintJobs("prop", "order-1", async () => {});

    expect(claimKeys).toHaveLength(2);
    expect(claimKeys[0]).toBeTruthy();
    expect(claimKeys[1]).toBe(claimKeys[0]);
  });

  it("treats a claim conflict as another till winning, not a printer failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.endsWith("/claim")) return json({ code: "CONFLICT" }, 409);
        if (url.includes("/pos/print-jobs")) return json([KITCHEN_JOB]);
        return json({}, 500);
      }),
    );

    const printed: string[] = [];
    const results = await processPendingPrintJobs("prop", "order-1", async (title, text) => {
      printed.push(`${title}\n${text}`);
    });
    expect(results).toMatchObject([{ ok: true }]);
    expect(printed).toEqual([]);
  });
});

describe("printJobs: kitchen tickets on paper (S8a)", () => {
  // Yetu's kitchen print document, as createStationTicketsAndPrintJobs writes it.
  const DOC = {
    orderId: "order-1", orderNumber: "POS-MR-261019-42", dailyNumber: 42, roundNumber: 2, station: "HOT",
    tableLabel: "12", serviceType: "DINE_IN", waiterName: "Amina Hassan", sentAt: "2026-10-19T09:40:00Z",
    items: [{ id: "i1", productId: "p-satay", name: "Satay", quantity: 2, modifiers: [{ name: "Extra sauce" }] }],
  };
  const JOB: POSPrintJob = { ...KITCHEN_JOB, document: DOC };
  const KITCHEN = { target: { kind: "network" as const, host: "192.168.1.50", port: 9100 }, width: 48 as const };

  function yetu(requests: string[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith("/claim")) return json({ ...JOB, status: "CLAIMED" });
        if (url.endsWith("/printed")) return json({ ...JOB, status: "PRINTED" });
        if (url.endsWith("/failed")) return json({ ...JOB, status: "FAILED" });
        if (url.includes("/pos/print-jobs")) return json([JOB]);
        return json({}, 500);
      }),
    );
  }
  const text = (bytes: Uint8Array) => Array.from(bytes, (b) => (b >= 0x20 && b < 0x7f) || b === 0x0a ? String.fromCharCode(b) : "").join("");

  it("goes to the kitchen's printer as a ticket, with who took it and staff's tags", async () => {
    const requests: string[] = [];
    yetu(requests);
    const raw: { target: unknown; bytes: Uint8Array }[] = [];
    const printFn = vi.fn();
    const results = await processPendingPrintJobs("prop", "order-1", printFn, {
      settings: { kitchenTickets: true, kitchen: KITCHEN, stations: {}, receipt: null, cashDrawer: false },
      printRaw: async (target, bytes) => void raw.push({ target, bytes }),
      tagsOf: (productId) => (productId === "p-satay" ? "Contains nuts" : undefined),
    });
    expect(results).toMatchObject([{ ok: true }]);
    expect(printFn).not.toHaveBeenCalled();
    expect(raw).toHaveLength(1);
    expect(raw[0].target).toEqual(KITCHEN.target);
    const paper = text(raw[0].bytes);
    expect(paper).toContain("ORDER 42");
    expect(paper).toContain("ROUND 2");
    expect(paper).toContain("Taken by Amina Hassan");
    expect(paper).toContain("2 x Satay");
    expect(paper).toContain("! Contains nuts");
    expect(requests.some((url) => url.endsWith("/printed"))).toBe(true);
  });

  it("a copy printed again says COPY and who printed it", async () => {
    yetu([]);
    const raw: Uint8Array[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        const copy = { ...JOB, document: { ...DOC, copy: true, printedAgainByName: "Grace Mushi" } };
        if (url.endsWith("/claim")) return json({ ...copy, status: "CLAIMED" });
        if (url.endsWith("/printed")) return json({ ...copy, status: "PRINTED" });
        if (url.includes("/pos/print-jobs")) return json([copy]);
        return json({}, 500);
      }),
    );
    await processPendingPrintJobs("prop", "order-1", vi.fn(), {
      settings: { kitchenTickets: true, kitchen: KITCHEN, stations: {}, receipt: null, cashDrawer: false },
      printRaw: async (_target, bytes) => void raw.push(bytes),
    });
    expect(text(raw[0])).toContain("*** COPY: printed again ***");
    expect(text(raw[0])).toContain("by Grace Mushi");
  });

  it("a till with paper kitchen tickets off leaves the job for one that prints them", async () => {
    const requests: string[] = [];
    yetu(requests);
    const printRaw = vi.fn();
    const printFn = vi.fn();
    const results = await processPendingPrintJobs("prop", "order-1", printFn, {
      settings: { kitchenTickets: false, kitchen: KITCHEN, stations: {}, receipt: null, cashDrawer: false }, printRaw,
    });
    expect(results).toMatchObject([{ ok: true }]);
    expect(requests.some((url) => url.endsWith("/claim"))).toBe(false);
    expect(printRaw).not.toHaveBeenCalled();
    expect(printFn).not.toHaveBeenCalled();
  });

  it("with no kitchen printer chosen, this till's own printer prints it, as before", async () => {
    yetu([]);
    const printRaw = vi.fn();
    const printed: string[] = [];
    await processPendingPrintJobs("prop", "order-1", async (_title, body) => void printed.push(body), {
      settings: { kitchenTickets: true, kitchen: null, stations: {}, receipt: null, cashDrawer: false }, printRaw,
    });
    expect(printRaw).not.toHaveBeenCalled();
    expect(printed[0]).toContain("Order 42");
  });

  it("a kitchen printer that doesn't answer is said to Yetu as failed", async () => {
    const requests: string[] = [];
    yetu(requests);
    const results = await processPendingPrintJobs("prop", "order-1", vi.fn(), {
      settings: { kitchenTickets: true, kitchen: KITCHEN, stations: {}, receipt: null, cashDrawer: false },
      printRaw: async () => { throw new Error("The kitchen printer didn't answer"); },
    });
    expect(results).toMatchObject([{ ok: false, error: "The kitchen printer didn't answer" }]);
    expect(requests.some((url) => url.endsWith("/failed"))).toBe(true);
  });
});

describe("printJobs: receipts on a thermal printer, the cash drawer (S8b)", () => {
  const RECEIPT_PRINTER = { target: { kind: "system" as const, name: "EPSON TM-T20" }, width: 48 as const };
  const DRAWER = [0x1b, 0x70, 0, 25, 250].join(",");
  // Yetu's receipt document (receipts.go ReceiptDocument).
  const SALE = {
    orderId: "order-7", orderNumber: "POS-a3f90c14", dailyNumber: 7, propertyName: "Kilima View", outletName: "Pool bar",
    initiatedByName: "Amina Hassan", operatorName: "Amina Hassan", serviceType: "DINE_IN", currency: "TZS",
    items: [{ name: "Kilimanjaro lager", quantity: 2, unitPriceMinor: 600_000, taxMinor: 183_051, totalMinor: 1_200_000 }],
    subtotalMinor: 1_016_949, discountMinor: 100_000, discountReason: "Regular guest", taxMinor: 165_051, totalMinor: 1_082_000,
    tenderMethod: "CASH", cashMinor: 1_082_000, settledAt: "2026-10-19T10:05:00Z",
  };
  const job = (jobType: string, document: Record<string, unknown>, extra: Partial<POSPrintJob> = {}): POSPrintJob =>
    ({ ...KITCHEN_JOB, id: `job-${jobType}`, sourceId: "order-7", jobType, document, ...extra });

  async function printed(printJob: POSPrintJob, cashDrawer = true, receipt: typeof RECEIPT_PRINTER | null = RECEIPT_PRINTER) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.endsWith("/claim")) return json({ ...printJob, status: "CLAIMED" });
        if (url.endsWith("/printed")) return json({ ...printJob, status: "PRINTED" });
        if (url.includes("/pos/print-jobs")) return json([printJob]);
        return json({}, 500);
      }),
    );
    const raw: { target: unknown; bytes: Uint8Array }[] = [];
    const text: string[] = [];
    await processPendingPrintJobs("prop", "order-7", async (_title, body) => void text.push(body), {
      settings: { kitchenTickets: true, kitchen: null, stations: {}, receipt, cashDrawer },
      printRaw: async (target, bytes) => void raw.push({ target, bytes }),
    });
    return { raw, text, drawer: raw.length === 1 && Array.from(raw[0].bytes).join(",").includes(DRAWER) };
  }
  const words = (bytes: Uint8Array) => Array.from(bytes, (b) => ((b >= 0x20 && b < 0x7f) || b === 0x0a ? String.fromCharCode(b) : "")).join("");

  it("a cash sale prints on the receipt printer, with its discount, and opens the drawer", async () => {
    const { raw, text, drawer } = await printed(job("RECEIPT", SALE));
    expect(text).toEqual([]);
    expect(raw[0].target).toEqual(RECEIPT_PRINTER.target);
    expect(words(raw[0].bytes)).toContain("Discount (Regular guest)");
    expect(drawer).toBe(true);
  });

  // fbc-peak #288 (2026-10-20): the bill before payment.
  it("a bill prints on the bill printer and opens no drawer; with no thermal printer it prints as words", async () => {
    const BILL_DOCUMENT = { ...SALE, kind: "BILL", paidMinor: 500_000, remainingMinor: 582_000, tenderMethod: undefined, cashMinor: 500_000, settledAt: undefined };
    const thermal = await printed(job("BILL", BILL_DOCUMENT));
    expect(thermal.raw[0].target).toEqual(RECEIPT_PRINTER.target);
    expect(words(thermal.raw[0].bytes)).toContain("TO PAY");
    expect(thermal.drawer).toBe(false);
    const plain = await printed(job("BILL", BILL_DOCUMENT), true, null);
    expect(plain.raw).toEqual([]);
    expect(plain.text[0]).toContain("BILL\nOrder 7");
    expect(plain.text[0]).toContain("TO PAY  TSh 5,820");
  });

  it("a card sale opens no drawer; a split with a cash part does", async () => {
    expect((await printed(job("RECEIPT", { ...SALE, tenderMethod: "CARD", cashMinor: undefined }))).drawer).toBe(false);
    expect((await printed(job("RECEIPT", { ...SALE, tenderMethod: "SPLIT", cashMinor: 500_000 }))).drawer).toBe(true);
  });

  it("a copy printed again says COPY and opens no drawer", async () => {
    const { raw, drawer } = await printed(job("RECEIPT", SALE, { reprintedFromId: "job-original" }));
    expect(words(raw[0].bytes)).toContain("*** COPY ***");
    expect(drawer).toBe(false);
  });

  it("a refund paid out in cash opens the drawer; with the drawer setting off, nothing does", async () => {
    const refund = { refundId: "refund-1", orderNumber: "POS-a3f90c14", dailyNumber: 7, currency: "TZS", totalMinor: 600_000,
      items: [], tenders: [{ paymentMethod: "CASH", amountMinor: 600_000 }] };
    expect((await printed(job("REFUND_RECEIPT", refund))).drawer).toBe(true);
    expect((await printed(job("RECEIPT", SALE), false)).drawer).toBe(false);
  });

  it("with no receipt printer chosen, receipts print as text on this computer's printer, as before", async () => {
    const { raw, text } = await printed(job("RECEIPT", SALE), true, null);
    expect(raw).toEqual([]);
    expect(text[0]).toContain("Discount (Regular guest)  -TSh");
  });
});

describe("printJobs: a void slip (fbc-peak 00125)", () => {
  // Yetu's void print document, as createVoidPrintJobs writes it.
  const VOID: POSPrintJob = {
    ...KITCHEN_JOB,
    id: "job-void",
    jobType: "KITCHEN_VOID",
    document: {
      orderId: "order-1", dailyNumber: 42, station: "BAR", tableLabel: "12", serviceType: "DINE_IN",
      waiterName: "Amina Hassan", askedByName: "Amina Hassan", approvedByName: "Grace Mushi", reason: "Spilled",
      voidedAt: "2026-10-21T09:40:00Z", wholeOrder: false,
      items: [{ id: "i1", productId: "p-tusker", name: "Tusker", quantity: 1, modifiers: [] }],
    },
  };
  const BAR = { target: { kind: "network" as const, host: "192.168.1.51", port: 9100 }, width: 48 as const };
  const KITCHEN = { target: { kind: "network" as const, host: "192.168.1.50", port: 9100 }, width: 48 as const };
  const text = (bytes: Uint8Array) => Array.from(bytes, (b) => (b >= 0x20 && b < 0x7f) || b === 0x0a ? String.fromCharCode(b) : "").join("");

  async function run(stations: Record<string, unknown>, kitchenTickets = true) {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith("/claim")) return json({ ...VOID, status: "CLAIMED" });
        if (url.endsWith("/printed")) return json({ ...VOID, status: "PRINTED" });
        if (url.includes("/pos/print-jobs")) return json([VOID]);
        return json({}, 500);
      }),
    );
    const raw: { target: unknown; bytes: Uint8Array }[] = [];
    const printFn = vi.fn();
    await processPendingPrintJobs("prop", "order-1", printFn, {
      settings: { kitchenTickets, kitchen: KITCHEN, stations: stations as never, receipt: null, cashDrawer: false },
      printRaw: async (target, bytes) => void raw.push({ target, bytes }),
    });
    return { requests, raw, printFn };
  }

  it("prints where the station's kitchen tickets print, telling it not to make the item", async () => {
    const { raw, printFn, requests } = await run({ BAR: BAR });
    expect(printFn).not.toHaveBeenCalled();
    expect(raw).toHaveLength(1);
    expect(raw[0].target).toEqual(BAR.target);
    const paper = text(raw[0].bytes);
    expect(paper).toContain("CANCELLED - BAR");
    expect(paper).toContain("DO NOT MAKE");
    expect(paper).toContain("1 x Tusker");
    expect(paper).toContain("Why: Spilled");
    expect(paper).not.toContain("TO PREPARE");
    expect(requests.some((url) => url.endsWith("/printed"))).toBe(true);
  });

  it("is left, like the station's tickets, where they print no paper", async () => {
    expect((await run({ BAR: "none" })).requests.some((url) => url.endsWith("/claim"))).toBe(false);
    expect((await run({ BAR: BAR }, false)).requests.some((url) => url.endsWith("/claim"))).toBe(false);
  });

  it("reads as a void slip through the system's own printer", () => {
    expect(formatPrintDocument(VOID)).toMatchObject({ title: "yetu-void-slip" });
    expect(formatPrintDocument(VOID).text).toContain("CANCELLED - BAR\nORDER 42\nDO NOT MAKE");
  });
});

describe("printJobs: no paper for a station on this till", () => {
  const job = (station: string): POSPrintJob => ({ ...KITCHEN_JOB, id: `job-${station}`, document: { dailyNumber: 7, station, items: [{ name: "Tusker lager", quantity: 2 }] } });
  const KITCHEN = { target: { kind: "network" as const, host: "192.168.1.50", port: 9100 }, width: 48 as const };

  async function run(printJob: POSPrintJob) {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith("/claim")) return json({ ...printJob, status: "CLAIMED" });
        if (url.endsWith("/printed")) return json({ ...printJob, status: "PRINTED" });
        if (url.includes("/pos/print-jobs")) return json([printJob]);
        return json({}, 500);
      }),
    );
    const printRaw = vi.fn();
    await processPendingPrintJobs("prop", "order-1", vi.fn(), {
      settings: { kitchenTickets: true, kitchen: KITCHEN, stations: { BAR: "none" }, receipt: null, cashDrawer: false },
      printRaw,
    });
    return { claimed: requests.some((url) => url.endsWith("/claim")), printed: printRaw.mock.calls.length };
  }

  it("the bar's ticket is left, never claimed; the kitchen's still prints", async () => {
    expect(await run(job("BAR"))).toEqual({ claimed: false, printed: 0 });
    expect(await run(job("HOT"))).toEqual({ claimed: true, printed: 1 });
  });
});

it("keeps optional guest and short-name context on system-printer production papers", () => {
 const paper = formatPrintDocument({...KITCHEN_JOB,document:{...KITCHEN_JOB.document,serviceType:"DINE_IN",tableLabel:"12",askForTable:false,guestCount:3}}).text;
 expect(paper).not.toContain("Table 12");
 expect(paper).toContain("Guests: 3");
});
