import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ItemModifierDialog } from "./ItemModifierDialog";
import type { POSCatalogProduct } from "../lib/posContracts";

const PRODUCT: POSCatalogProduct = {
  id: "product-1",
  code: "HOUSE",
  name: "House Special",
  priceMinor: 18_000,
  currency: "TZS",
  taxRateBp: 0,
  modifierGroups: [],
};

describe("ItemModifierDialog", () => {
  it("uses an accessible right-side sheet that preserves order context", () => {
    render(
      <ItemModifierDialog
        product={PRODUCT}
        currency="TZS"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const sheet = screen.getByRole("dialog", { name: "House Special" });
    expect(sheet).toHaveAttribute("data-side", "right");
    expect(sheet).toHaveAttribute("aria-modal", "true");
  });
});
