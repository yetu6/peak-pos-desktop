import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { renderPaperText } from "./PaperText";
import { kitchenTicketBytes } from "./kitchenTicket";
import { receiptBytes } from "./receipt";
import { readable } from "./escpos";
import { PRINT_BRAND, PRINT_BRAND_ADDRESS, printBrandFooter } from "./printBrand";

it.each([32, 48] as const)("preserves exact decoded bytes as DOM text with styled headings and footer at %s", width => {
  const bytes = kitchenTicketBytes({ station: "BAR", dailyNumber: 6, lines: [
    { name: "Water", quantity: 2, options: [], fulfilment: "PICKED" },
    { name: "Coffee", quantity: 1, options: [], fulfilment: "PREPARED" },
  ] }, width);
  const text = readable(bytes);
  const { container } = render(<pre>{renderPaperText(text)}</pre>);
  expect(container.textContent).toBe(text);
  expect(screen.getByText(PRINT_BRAND)).toHaveStyle({ textAlign: "center", fontWeight: "700", display: "inline-block", width: "100%" });
  expect(screen.getByText(PRINT_BRAND_ADDRESS)).toHaveStyle({ textAlign: "center", fontWeight: "400", display: "inline-block", width: "100%" });
  for (const heading of ["BAR ORDER", "HAND OVER", "MAKE"]) expect(screen.getByText(heading)).toHaveStyle({ fontWeight: "700" });
});
it("keeps leading footer padding in system text and the last newline", () => {
  const text = `BILL\n\n${printBrandFooter()}\n`;
  const { container } = render(<pre>{renderPaperText(text)}</pre>);
  expect(container.textContent).toBe(text);
  expect(screen.getByText(PRINT_BRAND)).toHaveStyle({ whiteSpace: "normal" });
  expect(screen.getByText(PRINT_BRAND_ADDRESS)).toHaveStyle({ whiteSpace: "normal" });
});
it("keeps the white bill’s actual text including item columns", () => {
  const text = readable(receiptBytes({ propertyName: "Bahari QA Hotel", beforePayment: true, lines: [] }, 32));
  const { container } = render(<pre className="y-paper">{renderPaperText(text)}</pre>);
  expect(container.textContent).toBe(text);
  expect(screen.getByText("BILL")).toHaveStyle({ fontWeight: "700" });
});

it("keeps an unavailable preview empty", () => {
  expect(renderPaperText(null)).toBeNull();
});
