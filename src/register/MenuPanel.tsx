import { SearchX, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, Dialog, EmptyState, SearchField, Skeleton, Tabs, Tile } from "../components/system";
import { isComposing } from "../lib/keyboard";
import { formatMoney } from "../lib/money";
import type { POSCatalogProduct, POSCategory } from "../lib/posContracts";
import type { FnbTillMenu } from "../fnb/fnbContracts";
import { MORE_GROUP, sizesOf, tileNote, tileOfferOf, tilePriceWords } from "../fnb/fnbWords";

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
  /** Mark an item sold out (false) or back in stock (true), after asking. Left out where it can't be done (offline). */
  onSoldOutToggle?: (product: POSCatalogProduct, available: boolean) => void;
  loading?: boolean;
  failed?: boolean;
  /** What a menu that didn't load says, when it isn't Yetu's live menu (the one saved for working offline). */
  failedWords?: { title: string; description: string };
  /**
   * The Restaurant & Bar module's menu for this outlet (S16-B4). When it is
   * on, its groups (Food, Drinks, ...) are the first tabs and the categories
   * the second; tiles carry staff's tags and the sizes. Off or absent: the
   * menu is exactly as before.
   */
  menu?: FnbTillMenu;
  /** The offline register: an item with sizes sells as its default size, said on its tile. */
  offline?: boolean;
}

/**
 * A typed key goes to the search only when nothing in particular has the
 * keys: the page itself, or the menu's background. A focused button, tab,
 * choice or field keeps its keys (Space presses a button).
 */
function searchTakesKeysFrom(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  return target === document.body || target === document.documentElement || target.hasAttribute("data-menu-background");
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
  failedWords = {
    title: "The menu didn't load",
    description: "Check the internet connection. The menu loads again on its own when Yetu can be reached.",
  },
  menu,
  offline = false,
}: MenuPanelProps) {
  const [asking, setAsking] = useState<POSCatalogProduct | null>(null);
  const grouped = menu?.enabled === true;
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

  // Menus on: the groups that are on, then More (the categories in no group, and items with none).
  const groupTabs = useMemo(() => {
    if (!grouped || !menu) return [];
    const known = new Set(activeCategories.map((category) => category.id));
    const tabs = menu.groups
      .map((group) => ({ id: group.id, name: group.name, categoryIds: group.categoryIds.filter((id) => known.has(id)) }))
      .filter((group) => group.categoryIds.length > 0);
    const more = menu.unplacedCategoryIds.filter((id) => known.has(id));
    const loose = products.some((item) => !item.categoryId);
    if (more.length > 0 || loose) tabs.push({ id: MORE_GROUP, name: "More", categoryIds: more });
    return tabs;
  }, [grouped, menu, activeCategories, products]);
  const [chosenGroup, setChosenGroup] = useState<string | null>(null);
  const activeGroup = groupTabs.find((group) => group.id === chosenGroup) ?? groupTabs[0];
  const categoryTabsFor = activeGroup
    ? activeGroup.categoryIds.map((id) => activeCategories.find((category) => category.id === id)).filter((c): c is POSCategory => Boolean(c))
    : activeCategories;

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = (item: POSCatalogProduct) =>
      !needle || item.name.toLowerCase().includes(needle) || item.code.toLowerCase().includes(needle);
    return products.filter((item) => {
      // With menus on, a search looks through the whole menu, whatever tab is open.
      if (activeGroup && needle) return matches(item);
      if (activeCategory !== ALL_CATEGORIES && item.categoryId !== activeCategory) return false;
      if (activeGroup && activeCategory === ALL_CATEGORIES) {
        const inGroup = item.categoryId !== undefined ? activeGroup.categoryIds.includes(item.categoryId) : activeGroup.id === MORE_GROUP;
        if (!inGroup) return false;
      }
      return matches(item);
    });
  }, [products, activeCategory, search, activeGroup]);

  // A physical keyboard types straight into the search, unless a field or a sheet has the keys.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || isComposing(event)) return;
      if (event.key.length !== 1 || event.key === " " || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!searchTakesKeysFrom(event.target) || document.querySelector('[role="dialog"]')) return;
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
    { value: ALL_CATEGORIES, label: activeGroup ? `All ${activeGroup.name.toLowerCase()}` : "All" },
    ...categoryTabsFor.map((category) => ({ value: category.id, label: category.name })),
  ];

  return (
    <div className="y-catalog">
      {groupTabs.length > 0 && activeGroup ? (
        <Tabs
          label="Menu"
          tabs={groupTabs.map((group) => ({ value: group.id, label: group.name }))}
          value={activeGroup.id}
          onChange={(groupId) => {
            setChosenGroup(groupId);
            onCategory(ALL_CATEGORIES);
          }}
          className="y-catalog__groups"
        />
      ) : null}
      <div className="y-catalog__bar">
        <Tabs label="Menu categories" tabs={tabs} value={activeCategory} onChange={onCategory} className="y-catalog__tabs" />
        <SearchField
          label="Search the menu"
          placeholder="Search the menu"
          value={search}
          onChange={onSearch}
          size={56}
          className="y-catalog__search"
          inputProps={{ id: SEARCH_ID, "data-testid": "catalog-search" } as Record<string, string>}
        />
      </div>
      {addBlocked ? (
        <p className="y-catalog__blocked" role="status">
          {addBlocked}
        </p>
      ) : null}
      <div className="y-catalog__scroll" data-menu-background="">
        {loading ? (
          <div className="y-menu-grid" aria-label="Loading the menu" data-testid="menu-grid">
            {Array.from({ length: 12 }, (_, index) => (
              <Skeleton key={index} height="var(--tile-height)" radius="card" />
            ))}
          </div>
        ) : failed ? (
          <EmptyState icon={<UtensilsCrossed />} title={failedWords.title} description={failedWords.description} />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={search.trim() ? `Nothing matches "${search.trim()}"` : "No items here"}
            description={search.trim() ? "Try another word, or clear the search." : "Choose another category."}
          />
        ) : (
          <div className="y-menu-grid" data-testid="menu-grid" onKeyDown={moveFocus}>
            {shown.map((item) => {
              // Happy hour (S17c): a rule in force prices the tile, menus on or off.
              const offered = tileOfferOf(menu, item.id, item.priceMinor, currency ?? item.currency, offline);
              return (
              <Tile
                key={item.id}
                data-testid={`menu-${item.name}`}
                name={item.name}
                offer={offered?.offer}
                price={offered ? offered.price : grouped ? tilePriceWords(item.priceMinor, sizesOf(menu, item.id), currency ?? item.currency, offline) : formatMoney(item.priceMinor, currency ?? item.currency)}
                note={grouped ? tileNote(menu, item.id, offline) : undefined}
                soldOut={item.isAvailable === false}
                disabled={Boolean(addBlocked)}
                mark={item.categoryId ? markOf.get(item.categoryId) : undefined}
                onClick={() => onTap(item)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (onSoldOutToggle) setAsking(item);
                }}
              />
              );
            })}
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
            <div className="y-catalog__ask-actions">
              <Button variant="quiet" onClick={() => setAsking(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onSoldOutToggle?.(asking, asking.isAvailable === false);
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
