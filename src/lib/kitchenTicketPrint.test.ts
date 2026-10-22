import { describe, expect, it, vi } from "vitest";
import {
  formatKitchenTicket,
  printKitchenTicket,
  ticketCopyFromKitchenTicket,
  ticketCopyFromOrder,
} from "./kitchenTicketPrint";

describe("kitchen ticket print", () => {
  it("formats Peak ticket lines without computing prices or tax", () => {
    const text = formatKitchenTicket({
      ticketNumber: "KT-12",
      orderNumber: "POS-1",
      tableNumber: "T4",
      sentAt: "12:04",
      status: "PENDING",
      lines: [
        { name: "Nyama Choma", quantity: "2", note: "no salt" },
        { name: "Tusker", quantity: "1" },
      ],
    });
    expect(text).toContain("KITCHEN ORDER");
    expect(text).toContain("KT-12");
    expect(text).toContain("Order POS-1");
    expect(text).toContain("Table T4");
    expect(text).toContain("Nyama Choma");
    expect(text).toContain("no salt");
    expect(text).not.toMatch(/tax|TSh|price/i);
  });

  it("names its station and says the service in words, as the thermal paper does", () => {
    const text = formatKitchenTicket({ station: "HOT", dailyNumber: 6, serviceType: "DINE_IN", tableNumber: "8", lines: [{ name: "Pilau", quantity: "1" }] });
    expect(text).toContain("Hot kitchen");
    expect(text).toContain("Dine in");
    expect(text).not.toContain("DINE IN");
    expect(formatKitchenTicket({ station: "BAR", dailyNumber: 6, lines: [{ name: "Soda", quantity: "1" }] })).not.toContain("\nBar\n");
  });

  it("maps a Peak kitchen ticket payload into a device copy", () => {
    const copy = ticketCopyFromKitchenTicket({
      ticketNumber: "KT-9",
      orderId: "abcdef01-1111-1111-1111-111111111111",
      sentAt: "2026-08-16T00:00:00Z",
      status: "PREPARING",
      items: [{ itemName: "Chapati", quantity: 3, specialRequest: "extra" }],
    });
    expect(copy.ticketNumber).toBe("KT-9");
    expect(copy.status).toBe("PREPARING");
    expect(copy.lines).toEqual([{ name: "Chapati", quantity: "3", note: "extra" }]);
  });

  it("maps order items already on the card after SEND", () => {
    const copy = ticketCopyFromOrder({
      orderNumber: "POS-1",
      tableNumber: "T4",
      items: [{ name: "Uji", quantity: 1 }],
    });
    expect(copy.lines[0]).toEqual({ name: "Uji", quantity: "1", note: undefined });
  });

  it("returns a device print failure without throwing when no printer is configured", async () => {
    const result = await printKitchenTicket(
      { lines: [{ name: "Uji", quantity: "1" }] },
      async () => {
        throw new Error("No printer is set up on this till");
      },
    );
    expect(result).toEqual({
      ok: false,
      error: "No printer is set up on this till",
    });
  });

  it("invokes the Tauri print command with preformatted ticket text", async () => {
    const invokeFn = vi.fn(async () => undefined);
    const result = await printKitchenTicket(
      { ticketNumber: "KT-1", lines: [{ name: "Uji", quantity: "1" }] },
      invokeFn,
    );
    expect(result.ok).toBe(true);
    expect(invokeFn).toHaveBeenCalledWith("print_kitchen_ticket", {
      ticket: { text: expect.stringContaining("KT-1") },
    });
  });
});
