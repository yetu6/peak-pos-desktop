import { formatMoney } from "../lib/money";
import type { FnbTillMenu, FnbTillSize } from "./fnbContracts";

/** The "More" tab: the outlet's categories in no group that is on. */
export const MORE_GROUP = "more";

/** What staff say about an item, on its tile: its tags ("Vegan · Contains nuts"). */
export function tagNote(menu: FnbTillMenu | undefined, productId: string): string | undefined {
  const tags = menu?.products[productId]?.tags ?? [];
  // Allergies first: what can harm a guest is read before what suits them.
  const ordered = [...tags.filter((tag) => tag.kind === "ALLERGEN"), ...tags.filter((tag) => tag.kind !== "ALLERGEN")];
  return ordered.length > 0 ? ordered.map((tag) => tag.label).join(" · ") : undefined;
}

/** An item's sizes on sale, in order; none when it sells as it is. */
export function sizesOf(menu: FnbTillMenu | undefined, productId: string): FnbTillSize[] {
  return menu?.sizes[productId] ?? [];
}

/**
 * The price on an item's tile: its own; with more than one size, the default
 * size's and how many sizes ("TSh 5,000 · 2 sizes"). Yetu prices the line.
 */
export function tilePriceWords(
  priceMinor: number,
  sizes: readonly FnbTillSize[],
  currency: string | undefined,
  offline = false,
): string {
  if (sizes.length <= 1) return formatMoney(priceMinor, currency);
  const shown = sizes.find((size) => size.isDefault) ?? sizes[0];
  // Offline the till sells the default size only (the offline menu has no sizes): say which.
  if (offline) return `${formatMoney(priceMinor, currency)} · ${shown.name}`;
  return `${formatMoney(shown.priceMinor, currency)} · ${sizes.length} sizes`;
}

/** A price rule in force for an item, as its tile shows it: the rule's name and the price it had. */
export interface TileOffer {
  label: string;
  was: string;
}

/**
 * S17c: the tile's price under a rule in force (happy hour), with what it
 * was; none offline (an offline till sells at the item's own price) or when
 * no rule prices the item.
 */
export function tileOfferOf(
  menu: FnbTillMenu | undefined,
  productId: string,
  basePriceMinor: number,
  currency: string | undefined,
  offline = false,
): { price: string; offer: TileOffer } | undefined {
  const rule = menu?.prices?.[productId];
  if (!rule || offline) return undefined;
  const sizes = sizesOf(menu, productId);
  const shown = sizes.find((size) => size.isDefault) ?? sizes[0];
  const was = shown ? shown.priceMinor : basePriceMinor;
  if (rule.priceMinor === was) return undefined;
  const more = sizes.length > 1 ? ` · ${sizes.length} sizes` : "";
  return { price: `${formatMoney(rule.priceMinor, currency)}${more}`, offer: { label: rule.ruleName, was: formatMoney(was, currency) } };
}

/** Under an item with sizes, offline: the other sizes wait for Yetu. */
export const OFFLINE_SIZES_NOTE = "More sizes need a connection";

/** A tile's note: staff's tags, and offline, that the other sizes wait for Yetu. */
export function tileNote(menu: FnbTillMenu | undefined, productId: string, offline = false): string | undefined {
  const parts = [tagNote(menu, productId), offline && sizesOf(menu, productId).length > 1 ? OFFLINE_SIZES_NOTE : undefined];
  const words = parts.filter(Boolean).join(" · ");
  return words || undefined;
}
