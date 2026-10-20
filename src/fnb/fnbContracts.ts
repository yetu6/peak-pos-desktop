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

/** What a price rule in force sets now for an item (happy hour, S17c); Yetu prices every line itself. */
export interface FnbTillPrice {
  ruleName: string;
  /** The item as it is (its default size). */
  priceMinor: number;
  /** Each size's price under the rule, by size id. */
  sizes?: Record<string, number>;
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
  /** S17c: the prices the rules in force set now, by product id (menus on or off). */
  prices?: Record<string, FnbTillPrice>;
  /** S17c: seconds until a rule starts or ends next; the till reads the menu again then (0: none). */
  pricesChangeInSeconds?: number;
}

/** The menu of a till whose outlet has menus off, or whose Yetu has no module. */
export const NO_MENU: FnbTillMenu = { enabled: false, groups: [], unplacedCategoryIds: [], sizes: {}, products: {} };

/**
 * fbc-peak `GET /api/v1/fnb/pos/reasons` (FnbTillReasons, 2026-10-20): the
 * reasons the till offers in one tap at its outlet, kept by the outlet's
 * managers in the hotel app, else Yetu's standard lists. The till adds
 * "Another reason" to each.
 */
export interface FnbTillReasons {
  discount: string[];
  void: string[];
  refund: string[];
  cashIn: string[];
  cashOut: string[];
}
