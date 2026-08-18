import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatPrintDocument,
  processPendingPrintJobs,
  reprintSource,
  ticketCopyFromPrintDocument,
} from "./printJobs";

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

describe("printJobs", () => {
  it("formats a Peak kitchen document without prices", () => {
    const copy = ticketCopyFromPrintDocument({
      kind: "kitchen_ticket",
      ticketNumber: "KDS-1",
      tableNumber: "12",
      lines: [{ name: "Stew", quantity: "1", note: "no chili" }],
    });
    const formatted = formatPrintDocument({
      id: "job-1",
      propertyId: "p",
      outletId: "o",
      jobType: "kitchen_ticket",
      sourceType: "kitchen_ticket",
      sourceId: "ticket-1",
      reprint: false,
      status: "pending",
      document: {
        ticketNumber: "KDS-1",
        lines: [{ name: "Stew", quantity: "1" }],
      },
    });
    expect(copy.lines[0]?.note).toBe("no chili");
    expect(formatted.title).toBe("peak-kitchen-ticket");
    expect(formatted.text).toContain("KDS-1");
    expect(formatted.text).not.toMatch(/tax|TSh|price/i);
  });

  it("formats a Peak receipt with the posted totals", () => {
    const formatted = formatPrintDocument({
      id: "job-r",
      propertyId: "p",
      outletId: "o",
      jobType: "receipt",
      sourceType: "pos_order",
      sourceId: "order-1",
      reprint: false,
      status: "pending",
      document: {
        kind: "receipt",
        orderNumber: "POS-1",
        tableNumber: "12",
        settlementMethod: "cash",
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

  it("claims a pending job, prints, and acks printed", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes("pos-print-jobs?") && url.includes("pending")) {
          return json([
            {
              id: "job-1",
              propertyId: "prop",
              outletId: "out",
              jobType: "kitchen_ticket",
              sourceType: "kitchen_ticket",
              sourceId: "ticket-1",
              reprint: false,
              status: "pending",
              document: { ticketNumber: "KDS-1", lines: [{ name: "Stew", quantity: "1" }] },
            },
          ]);
        }
        if (url.endsWith("/claim")) {
          calls.push("claim");
          return json({
            id: "job-1",
            propertyId: "prop",
            outletId: "out",
            jobType: "kitchen_ticket",
            sourceType: "kitchen_ticket",
            sourceId: "ticket-1",
            reprint: false,
            status: "claimed",
            document: { ticketNumber: "KDS-1", lines: [{ name: "Stew", quantity: "1" }] },
          });
        }
        if (url.endsWith("/printed")) {
          calls.push("printed");
          return json({ status: "printed" });
        }
        return json({}, 500);
      }),
    );

    const printed: string[] = [];
    const results = await processPendingPrintJobs("prop", "ticket-1", async (title, text) => {
      printed.push(`${title}\n${text}`);
    });
    expect(results).toEqual([{ ok: true }]);
    expect(calls).toEqual(["claim", "printed"]);
    expect(printed[0]).toContain("KDS-1");
  });

  it("acks failed when the local printer throws and does not pretend the send failed at Peak", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes("pending")) {
          return json([
            {
              id: "job-1",
              propertyId: "prop",
              outletId: "out",
              jobType: "kitchen_ticket",
              sourceType: "kitchen_ticket",
              sourceId: "ticket-1",
              reprint: false,
              status: "pending",
              document: { lines: [{ name: "Stew", quantity: "1" }] },
            },
          ]);
        }
        if (url.endsWith("/claim")) {
          return json({
            id: "job-1",
            propertyId: "prop",
            outletId: "out",
            jobType: "kitchen_ticket",
            sourceType: "kitchen_ticket",
            sourceId: "ticket-1",
            reprint: false,
            status: "claimed",
            document: { lines: [{ name: "Stew", quantity: "1" }] },
          });
        }
        if (url.endsWith("/failed")) {
          return json({ status: "failed" });
        }
        return json({}, 500);
      }),
    );

    const results = await processPendingPrintJobs("prop", "ticket-1", async () => {
      throw new Error("No kitchen printer is configured");
    });
    expect(results).toEqual([{ ok: false, error: "No kitchen printer is configured" }]);
  });

  it("reprint asks Peak for a new job instead of printing a local copy", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes("printed,failed") || url.includes("printed%2Cfailed")) {
          return json([
            {
              id: "job-1",
              propertyId: "prop",
              outletId: "out",
              jobType: "kitchen_ticket",
              sourceType: "kitchen_ticket",
              sourceId: "ticket-1",
              reprint: false,
              status: "printed",
              document: { ticketNumber: "KDS-1", lines: [{ name: "Stew", quantity: "1" }] },
            },
          ]);
        }
        if (url.endsWith("/reprint")) {
          calls.push("reprint");
          return json({
            id: "job-2",
            propertyId: "prop",
            outletId: "out",
            jobType: "kitchen_ticket",
            sourceType: "kitchen_ticket",
            sourceId: "ticket-1",
            reprint: true,
            status: "pending",
            document: { ticketNumber: "KDS-1", lines: [{ name: "Stew", quantity: "1" }] },
          });
        }
        if (url.endsWith("/claim")) {
          calls.push("claim");
          return json({
            id: "job-2",
            propertyId: "prop",
            outletId: "out",
            jobType: "kitchen_ticket",
            sourceType: "kitchen_ticket",
            sourceId: "ticket-1",
            reprint: true,
            status: "claimed",
            document: { ticketNumber: "KDS-1", lines: [{ name: "Stew", quantity: "1" }] },
          });
        }
        if (url.endsWith("/printed")) {
          calls.push("printed");
          return json({ status: "printed" });
        }
        return json({}, 500);
      }),
    );

    const result = await reprintSource("prop", "ticket-1", async () => undefined);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["reprint", "claim", "printed"]);
  });

  it("treats a claim conflict as another till winning, not a printer failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes("pending")) {
          return json([
            {
              id: "job-1",
              propertyId: "prop",
              outletId: "out",
              jobType: "kitchen_ticket",
              sourceType: "kitchen_ticket",
              sourceId: "ticket-1",
              reprint: false,
              status: "pending",
              document: { lines: [{ name: "Stew", quantity: "1" }] },
            },
          ]);
        }
        if (url.endsWith("/claim")) {
          return json({ code: "POS_CONFLICT" }, 409);
        }
        return json({}, 500);
      }),
    );

    const printed: string[] = [];
    const results = await processPendingPrintJobs("prop", "ticket-1", async (title, text) => {
      printed.push(`${title}\n${text}`);
    });
    expect(results).toEqual([{ ok: true }]);
    expect(printed).toEqual([]);
  });
});
