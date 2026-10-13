import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { POSCatalogProduct, POSCategory } from "../lib/posContracts";
import { MenuPanel, type MenuPanelProps } from "./MenuPanel";

const CATEGORIES: POSCategory[] = [
  { id: "drinks", outletId: "o", code: "DRK", name: "Drinks", sortOrder: 2, isActive: true },
  { id: "mains", outletId: "o", code: "MNS", name: "Mains", sortOrder: 1, isActive: true },
  { id: "old", outletId: "o", code: "OLD", name: "Old menu", sortOrder: 0, isActive: false },
];

function product(id: string, name: string, categoryId: string, priceMinor: number, extra: Partial<POSCatalogProduct> = {}): POSCatalogProduct {
  return { id, categoryId, code: id.toUpperCase(), name, priceMinor, currency: "TZS", taxRateBp: 1800, isAvailable: true, ...extra };
}

const PRODUCTS: POSCatalogProduct[] = [
  product("tusker", "Tusker Lager", "drinks", 500_000),
  product("nyama", "Nyama Choma", "mains", 1_200_000),
  product("chips", "Chips Mayai", "mains", 600_000, { isAvailable: false }),
  product("soda", "Soda", "drinks", 200_000),
];

function Menu(props: Partial<MenuPanelProps>) {
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  return (
    <MenuPanel
      categories={CATEGORIES}
      products={PRODUCTS}
      currency="TZS"
      activeCategory={category}
      onCategory={setCategory}
      search={search}
      onSearch={setSearch}
      addBlocked={null}
      onTap={vi.fn()}
      onSoldOutToggle={vi.fn()}
      {...props}
    />
  );
}

const tileNames = () => screen.getAllByTestId(/^menu-(?!grid$)/).map((tile) => tile.getAttribute("data-testid"));

describe("MenuPanel", () => {
  it("offers All, then each active category in the catalog's order; a category shows only its items", async () => {
    render(<Menu />);
    const tabs = within(screen.getByRole("tablist", { name: "Menu categories" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["All", "Mains", "Drinks"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Drinks" }));
    expect(tileNames()).toEqual(["menu-Tusker Lager", "menu-Soda"]);
  });

  it("keeps the search on screen and finds items by name or code", async () => {
    render(<Menu />);
    const search = screen.getByRole("searchbox", { name: "Search the menu" });
    await userEvent.type(search, "choma");
    expect(tileNames()).toEqual(["menu-Nyama Choma"]);
    await userEvent.clear(search);
    await userEvent.type(search, "SODA");
    expect(tileNames()).toEqual(["menu-Soda"]);
  });

  it("keeps every item where the catalog puts it, a sold-out item greyed in place with the words", async () => {
    const onTap = vi.fn();
    render(<Menu onTap={onTap} />);
    expect(tileNames()).toEqual(["menu-Tusker Lager", "menu-Nyama Choma", "menu-Chips Mayai", "menu-Soda"]);
    const soldOut = screen.getByTestId("menu-Chips Mayai");
    expect(soldOut).toHaveTextContent("Sold out");
    await userEvent.click(soldOut);
    expect(onTap).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("menu-Soda"));
    expect(onTap).toHaveBeenCalledWith(PRODUCTS[3]);
  });

  it("shows each item's price from the catalog", () => {
    render(<Menu />);
    expect(screen.getByTestId("menu-Nyama Choma")).toHaveTextContent("TSh 12,000");
  });

  it("says why items can't be added, and adds nothing", async () => {
    const onTap = vi.fn();
    render(<Menu onTap={onTap} addBlocked="This order has gone to the kitchen. Start a new sale to add more." />);
    expect(screen.getByRole("status")).toHaveTextContent("This order has gone to the kitchen. Start a new sale to add more.");
    await userEvent.click(screen.getByTestId("menu-Soda"));
    expect(onTap).not.toHaveBeenCalled();
  });

  it("sends a key typed anywhere on Sell into the search", async () => {
    render(<Menu />);
    fireEvent.keyDown(document.body, { key: "t" });
    const search = screen.getByRole("searchbox", { name: "Search the menu" });
    expect(search).toHaveFocus();
    expect(search).toHaveValue("t");
  });

  it("Space presses a focused item or tab; it never goes into the search", async () => {
    const onTap = vi.fn();
    render(<Menu onTap={onTap} />);
    screen.getByTestId("menu-Soda").focus();
    await userEvent.keyboard(" ");
    expect(onTap).toHaveBeenCalledWith(PRODUCTS[3]);
    screen.getByRole("tab", { name: "Drinks" }).focus();
    await userEvent.keyboard(" ");
    expect(screen.getByRole("tab", { name: "Drinks" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("searchbox", { name: "Search the menu" })).toHaveValue("");
  });

  it("Space on the page itself doesn't go into the search", () => {
    render(<Menu />);
    fireEvent.keyDown(document.body, { key: " " });
    expect(screen.getByRole("searchbox", { name: "Search the menu" })).toHaveValue("");
  });

  it("a letter typed while a control has focus stays with that control", async () => {
    render(<Menu />);
    screen.getByTestId("menu-Soda").focus();
    await userEvent.keyboard("t");
    expect(screen.getByRole("searchbox", { name: "Search the menu" })).toHaveValue("");
    expect(screen.getByTestId("menu-Soda")).toHaveFocus();
  });

  it("leaves typed keys alone while a sheet is open", () => {
    render(<Menu />);
    const sheet = document.createElement("div");
    sheet.setAttribute("role", "dialog");
    document.body.append(sheet);
    fireEvent.keyDown(document.body, { key: "t" });
    expect(screen.getByRole("searchbox", { name: "Search the menu" })).toHaveValue("");
    sheet.remove();
  });

  it("moves between items with the arrow keys", async () => {
    render(<Menu />);
    screen.getByTestId("menu-Tusker Lager").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByTestId("menu-Nyama Choma")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByTestId("menu-Tusker Lager")).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(screen.getByTestId("menu-Soda")).toHaveFocus();
  });

  it("asks before marking an item sold out, and before bringing it back", async () => {
    const onSoldOutToggle = vi.fn();
    render(<Menu onSoldOutToggle={onSoldOutToggle} />);
    fireEvent.contextMenu(screen.getByTestId("menu-Soda"));
    const ask = screen.getByRole("dialog", { name: "Mark Soda sold out?" });
    expect(onSoldOutToggle).not.toHaveBeenCalled();
    await userEvent.click(within(ask).getByRole("button", { name: "Mark sold out" }));
    expect(onSoldOutToggle).toHaveBeenCalledWith(PRODUCTS[3], false);

    fireEvent.contextMenu(screen.getByTestId("menu-Chips Mayai"));
    const back = screen.getByRole("dialog", { name: "Mark Chips Mayai back in stock?" });
    await userEvent.click(within(back).getByRole("button", { name: "Back in stock" }));
    expect(onSoldOutToggle).toHaveBeenCalledWith(PRODUCTS[2], true);
  });
});
