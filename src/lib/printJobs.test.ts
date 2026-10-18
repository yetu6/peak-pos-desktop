import { afterEach, describe, expect, it, vi } from "vitest";
import { formatPrintDocument, processPendingPrintJobs, ticketCopyFromPrintDocument } from "./printJobs";
import type { POSPrintJob } from "./posContracts";

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
    expect(formatted.title).toBe("yetu-invoice");
    expect(formatted.text).toContain("INVOICE");
    expect(formatted.text).toContain("POS-1");
    expect(formatted.text).toContain("TOTAL  23.60");
    expect(formatted.text).toContain("Tax  3.60");
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
    expect(results).toEqual([{ ok: true }]);
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
      throw new Error("No printer is configured");
    });
    expect(results).toEqual([{ ok: false, error: "No printer is configured" }]);
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
    expect(results).toEqual([{ ok: true }]);
    expect(printed).toEqual([]);
  });
});
