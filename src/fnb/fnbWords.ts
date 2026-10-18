import { formatMoney } from "../lib/money";
import type { FnbTillMenu, FnbTillSize } from "./fnbContracts";

/** The "More" tab: the outlet's categories in no group that is on. */
export const MORE_GROUP = "more";

/** What staff say about an item, on its tile: its tags ("Vegan · Contains nuts"). */
export function tagNote(menu: FnbTillMenu | undefined, productId: string): string | undefined {
  const tags = menu?.products[productId]?.tags ?? [];
  return tags.length > 0 ? tags.map((tag) => tag.label).join(" · ") : undefined;
}

/** An item's sizes on sale, in order; none when it sells as it is. */
export function sizesOf(menu: FnbTillMenu | undefined, productId: string): FnbTillSize[] {
  return menu?.sizes[productId] ?? [];
}

/**
 * The price on an item's tile: its own; with more than one size, the default
 * size's and how many sizes ("TSh 5,000 · 2 sizes"). Yetu prices the line.
 */
export function tilePriceWords(priceMinor: number, sizes: readonly FnbTillSize[], currency: string | undefined): string {
  if (sizes.length <= 1) return formatMoney(priceMinor, currency);
  const shown = sizes.find((size) => size.isDefault) ?? sizes[0];
  return `${formatMoney(shown.priceMinor, currency)} · ${sizes.length} sizes`;
}
