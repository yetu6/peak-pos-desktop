import { SearchX, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, Dialog, EmptyState, SearchField, Skeleton, Tabs, Tile } from "../components/system";
import { isComposing } from "../lib/keyboard";
import { formatMoney } from "../lib/money";
import type { POSCatalogProduct, POSCategory } from "../lib/posContracts";

export const ALL_CATEGORIES = "all";
const SEARCH_ID = "menu-search";
const MARKS = 4;

export interface MenuPanelProps {
  categories: readonly POSCategory[];
  /** In the catalog's own order; items keep these positions. */
  products: readonly POSCatalogProduct[];
  currency: string | undefined;
  activeCategory: string;
  onCategory: (categoryId: string) => void;
  search: string;
  onSearch: (search: string) => void;
  /** Why nothing can be added just now, in words; null when items can be added. */
  addBlocked: string | null;
  onTap: (product: POSCatalogProduct) => void;
  /** Mark an item sold out (false) or back in stock (true), after asking. */
  onSoldOutToggle: (product: POSCatalogProduct, available: boolean) => void;
  loading?: boolean;
  failed?: boolean;
}

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The menu: category tabs (with All), a search that is always there, and the
 * items as text tiles in the catalog's order. A sold-out item keeps its place,
 * greyed, with the words. A key typed anywhere on Sell goes into the search;
 * arrow keys move between items.
 */
export function MenuPanel({
  categories,
  products,
  currency,
  activeCategory,
  onCategory,
  search,
  onSearch,
  addBlocked,
  onTap,
  onSoldOutToggle,
  loading = false,
  failed = false,
}: MenuPanelProps) {
  const [asking, setAsking] = useState<POSCatalogProduct | null>(null);
  const searchNow = useRef(search);
  searchNow.current = search;

  const activeCategories = useMemo(
    () => categories.filter((category) => category.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  );
  const markOf = useMemo(() => {
    const marks = new Map<string, 1 | 2 | 3 | 4>();
    activeCategories.forEach((category, index) => marks.set(category.id, ((index % MARKS) + 1) as 1 | 2 | 3 | 4));
    return marks;
  }, [activeCategories]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((item) => {
      if (activeCategory !== ALL_CATEGORIES && item.categoryId !== activeCategory) return false;
      if (!needle) return true;
      return item.name.toLowerCase().includes(needle) || item.code.toLowerCase().includes(needle);
    });
  }, [products, activeCategory, search]);

  // A physical keyboard types straight into the search, unless a field or a sheet has the keys.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || isComposing(event)) return;
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
      if (typingTarget(event.target) || document.querySelector('[role="dialog"]')) return;
      const field = document.getElementById(SEARCH_ID);
      if (!(field instanceof HTMLInputElement)) return;
      event.preventDefault();
      onSearch(searchNow.current + event.key);
      field.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onSearch]);

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const tiles = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".y-tile"));
    const index = tiles.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const columns =
      getComputedStyle(event.currentTarget).gridTemplateColumns.split(" ").filter(Boolean).length ||
      Number.parseInt(getComputedStyle(event.currentTarget).getPropertyValue("--menu-columns"), 10) ||
      1;
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      ArrowDown: index + columns,
      ArrowUp: index - columns,
      Home: 0,
      End: tiles.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    tiles[Math.max(0, Math.min(tiles.length - 1, next))]?.focus();
  }

  const tabs = [
    { value: ALL_CATEGORIES, label: "All" },
    ...activeCategories.map((category) => ({ value: category.id, label: category.name })),
  ];

  return (
    <div className="y-menu">
      <div className="y-menu__bar">
        <Tabs label="Menu categories" tabs={tabs} value={activeCategory} onChange={onCategory} className="y-menu__tabs" />
        <SearchField
          label="Search the menu"
          placeholder="Search the menu"
          value={search}
          onChange={onSearch}
          size={56}
          className="y-menu__search"
          inputProps={{ id: SEARCH_ID, "data-testid": "catalog-search" } as Record<string, string>}
        />
      </div>
      {addBlocked ? (
        <p className="y-menu__blocked" role="status">
          {addBlocked}
        </p>
      ) : null}
      <div className="y-menu__scroll">
        {loading ? (
          <div className="y-menu-grid" aria-label="Loading the menu" data-testid="menu-grid">
            {Array.from({ length: 12 }, (_, index) => (
              <Skeleton key={index} height="var(--tile-height)" radius="card" />
            ))}
          </div>
        ) : failed ? (
          <EmptyState
            icon={<UtensilsCrossed />}
            title="The menu didn't load"
            description="Check the internet connection. The menu loads again on its own when Yetu can be reached."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={search.trim() ? `Nothing matches "${search.trim()}"` : "No items here"}
            description={search.trim() ? "Try another word, or clear the search." : "Choose another category."}
          />
        ) : (
          <div className="y-menu-grid" data-testid="menu-grid" onKeyDown={moveFocus}>
            {shown.map((item) => (
              <Tile
                key={item.id}
                data-testid={`menu-${item.name}`}
                name={item.name}
                price={formatMoney(item.priceMinor, currency ?? item.currency)}
                soldOut={item.isAvailable === false}
                disabled={Boolean(addBlocked)}
                mark={item.categoryId ? markOf.get(item.categoryId) : undefined}
                onClick={() => onTap(item)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setAsking(item);
                }}
              />
            ))}
          </div>
        )}
      </div>
      {asking ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
          title={asking.isAvailable === false ? `Mark ${asking.name} back in stock?` : `Mark ${asking.name} sold out?`}
          description={
            asking.isAvailable === false
              ? "It can be added to orders again on every till."
              : "It stays on the menu, greyed, and can't be added until it is back in stock."
          }
          footer={
            <div className="y-menu__ask-actions">
              <Button variant="quiet" onClick={() => setAsking(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onSoldOutToggle(asking, asking.isAvailable === false);
                  setAsking(null);
                }}
              >
                {asking.isAvailable === false ? "Back in stock" : "Mark sold out"}
              </Button>
            </div>
          }
        />
      ) : null}
    </div>
  );
}
