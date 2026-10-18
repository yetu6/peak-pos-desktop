/**
 * The Restaurant & Bar module's contract for the till (fbc-peak
 * `GET /api/v1/fnb/pos/menu`, schemas FnbTillMenu, FnbTillSize,
 * FnbTillProduct; S16-B2). The module is apart from the POS core: a till
 * without it, or an outlet with menus off, sells exactly as before.
 */

export interface FnbTillGroup {
  id: string;
  name: string;
  /** The group's categories, in order. */
  categoryIds: string[];
}

/** A size as the till offers it; Yetu still prices every line. */
export interface FnbTillSize {
  id: string;
  name: string;
  priceMinor: number;
  /** What the item sells as when no size is said; its price is the item's. */
  isDefault: boolean;
  /** False when sold out today. */
  isAvailable: boolean;
}

export type FnbTagKind = "DIETARY" | "ALLERGEN" | "OTHER";

/** What staff say about an item: its description and its tags on use. */
export interface FnbTillProduct {
  description?: string;
  tags: { label: string; kind: FnbTagKind }[];
}

export interface FnbTillMenu {
  /** False: menus are off for this outlet; the till shows its categories as it always has. */
  enabled: boolean;
  /** The groups that are on, each with its categories that are on, in order. */
  groups: FnbTillGroup[];
  /** The outlet's categories in no group that is on: shown after the groups. */
  unplacedCategoryIds: string[];
  /** Each product's sizes on sale, by product id, in order. */
  sizes: Record<string, FnbTillSize[]>;
  /** What staff say about each item, by product id. */
  products: Record<string, FnbTillProduct>;
}

/** The menu of a till whose outlet has menus off, or whose Yetu has no module. */
export const NO_MENU: FnbTillMenu = { enabled: false, groups: [], unplacedCategoryIds: [], sizes: {}, products: {} };
