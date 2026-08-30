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

describe("printJobs", () => {
  it("formats a Peak kitchen ticket without prices", () => {
    const copy = ticketCopyFromPrintDocument(KITCHEN_JOB.document);
    const formatted = formatPrintDocument(KITCHEN_JOB);
    expect(copy.lines[0]?.name).toBe("Stew");
    expect(formatted.title).toBe("peak-kitchen-ticket");
    expect(formatted.text).toContain("KDS-1");
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
    expect(formatted.title).toBe("peak-receipt");
    expect(formatted.text).toContain("RECEIPT");
    expect(formatted.text).toContain("POS-1");
    expect(formatted.text).toContain("TOTAL  23.60");
    expect(formatted.text).toContain("Tax  3.60");
  });

  it("falls back to the generic ticket formatter for an unrecognized job type instead of dropping it", () => {
    const formatted = formatPrintDocument({ ...KITCHEN_JOB, jobType: "SOMETHING_NEW" });
    expect(formatted.title).toBe("peak-something-new");
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
    expect(printed[0]).toContain("KDS-1");
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
