import type { LocalCatalogView } from "../lib/localPosCore";
import type { POSCatalogProduct, POSCategory } from "../lib/posContracts";

/** The saved menu in the shapes the menu panel reads (positions and names as saved). */
export function menuOf(catalog: LocalCatalogView | undefined): { categories: POSCategory[]; products: POSCatalogProduct[] } {
  if (!catalog) return { categories: [], products: [] };
  return {
    categories: catalog.categories.map((category, index) => ({
      id: category.id,
      outletId: "",
      code: category.code,
      name: category.name,
      sortOrder: index,
      isActive: true,
    })),
    products: catalog.products.map((product) => ({
      id: product.id,
      categoryId: product.categoryId,
      code: product.code,
      name: product.name,
      priceMinor: product.priceMinor,
      currency: product.currency,
      taxRateBp: product.taxRateBp,
      isAvailable: true,
      modifierGroups: product.modifierGroups.map((group) => ({
        id: group.id,
        productId: product.id,
        name: group.name,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        isActive: true,
        options: group.options.map((option) => ({
          id: option.id,
          groupId: group.id,
          name: option.name,
          priceDeltaMinor: option.priceDeltaMinor,
          isAvailable: true,
        })),
      })),
    })),
  };
}

