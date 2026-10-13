import type { POSCatalogProduct, POSOrderItem } from "../lib/posContracts";

/**
 * The catalog option ids for a line's options, matched by group and option
 * name (Yetu keeps the names on the line, not the ids). Null when any of them
 * is no longer on the menu, or when a name matches more than one group or
 * option, so the options sheet asks again instead of guessing.
 */
export function optionIdsFor(line: POSOrderItem, product: POSCatalogProduct): string[] | null {
  const ids: string[] = [];
  for (const modifier of line.modifiers ?? []) {
    const groups = (product.modifierGroups ?? []).filter(
      (candidate) => candidate.isActive !== false && candidate.name === modifier.groupName,
    );
    if (groups.length !== 1) return null;
    const options = (groups[0].options ?? []).filter(
      (candidate) => candidate.isAvailable !== false && candidate.name === modifier.optionName,
    );
    if (options.length !== 1) return null;
    ids.push(options[0].id);
  }
  return ids;
}
