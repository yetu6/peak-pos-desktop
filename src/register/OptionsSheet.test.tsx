import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { POSCatalogProduct } from "../lib/posContracts";
import { OptionsSheet } from "./OptionsSheet";

const BURGER: POSCatalogProduct = {
  id: "burger",
  code: "BRG",
  name: "House burger",
  priceMinor: 800_000,
  currency: "TZS",
  taxRateBp: 1800,
  isAvailable: true,
  modifierGroups: [
    {
      id: "extras",
      productId: "burger",
      name: "Extras",
      minSelect: 0,
      maxSelect: 2,
      isActive: true,
      options: [
        { id: "cheese", groupId: "extras", name: "Cheese", priceDeltaMinor: 150_000, isAvailable: true },
        { id: "egg", groupId: "extras", name: "Egg", priceDeltaMinor: 100_000, isAvailable: true },
        { id: "bacon", groupId: "extras", name: "Bacon", priceDeltaMinor: 200_000, isAvailable: true },
        { id: "truffle", groupId: "extras", name: "Truffle", priceDeltaMinor: 900_000, isAvailable: false },
      ],
    },
    {
      id: "cook",
      productId: "burger",
      name: "Cooked",
      minSelect: 1,
      maxSelect: 1,
      isActive: true,
      options: [
        { id: "medium", groupId: "cook", name: "Medium", priceDeltaMinor: 0, isAvailable: true },
        { id: "well", groupId: "cook", name: "Well done", priceDeltaMinor: 0, isAvailable: true },
      ],
    },
    { id: "gone", productId: "burger", name: "Old sauces", minSelect: 1, maxSelect: 1, isActive: false, options: [] },
  ],
};

function renderSheet(onAdd = vi.fn()) {
  render(<OptionsSheet product={BURGER} currency="TZS" onCancel={vi.fn()} onAdd={onAdd} />);
  return { onAdd, sheet: screen.getByRole("dialog", { name: "House burger" }) };
}

const add = () => screen.getByTestId("modifier-confirm-add");

describe("OptionsSheet", () => {
  it("puts required choices first, marked Choose 1, then optional ones, Up to 2", () => {
    const { sheet } = renderSheet();
    const groups = within(sheet).getAllByRole("group").filter((group) => group.hasAttribute("data-option-group"));
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["Cooked, choose 1", "Extras, up to 2"]);
    expect(groups[0]).toHaveTextContent("Choose 1");
    expect(groups[1]).toHaveTextContent("Up to 2");
  });

  it("doesn't offer an option that isn't available", () => {
    renderSheet();
    expect(screen.queryByRole("checkbox", { name: /Truffle/ })).not.toBeInTheDocument();
  });

  it("holds Add until every required choice is made; one choice replaces another", async () => {
    renderSheet();
    expect(add()).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /Medium/ }));
    expect(add()).toBeEnabled();
    await userEvent.click(screen.getByRole("radio", { name: /Well done/ }));
    expect(screen.getByRole("radio", { name: /Medium/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Well done/ })).toBeChecked();
  });

  it("holds Add while more than the most allowed are chosen, as the catalog says", async () => {
    renderSheet();
    await userEvent.click(screen.getByRole("radio", { name: /Medium/ }));
    for (const name of [/Cheese/, /Egg/, /Bacon/]) await userEvent.click(screen.getByRole("checkbox", { name }));
    expect(add()).toBeDisabled();
    expect(screen.getByRole("group", { name: "Extras, up to 2" })).toHaveTextContent("Up to 2. Take one off.");
    await userEvent.click(screen.getByRole("checkbox", { name: /Bacon/ }));
    expect(add()).toBeEnabled();
  });

  it("shows what is being added, priced from the catalog for the choices and quantity", async () => {
    renderSheet();
    await userEvent.click(screen.getByRole("radio", { name: /Medium/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Cheese/ }));
    expect(add()).toHaveTextContent("Add to order · TSh 9,500");
    await userEvent.click(screen.getByRole("button", { name: "One more House burger" }));
    expect(add()).toHaveTextContent("Add to order · TSh 19,000");
  });

  it("sends the chosen option ids and the quantity", async () => {
    const { onAdd } = renderSheet();
    await userEvent.click(screen.getByRole("radio", { name: /Well done/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Egg/ }));
    await userEvent.click(screen.getByRole("button", { name: "One more House burger" }));
    await userEvent.click(add());
    expect(onAdd).toHaveBeenCalledWith({ quantity: 2, modifierOptionIds: ["well", "egg"] });
  });
});
