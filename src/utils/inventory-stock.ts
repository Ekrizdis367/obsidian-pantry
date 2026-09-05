import { normaliseName } from "../parser/ingredient";
import { GroceryItem, InventoryItem } from "../types";

/**
 * Whether an inventory item should suppress matching grocery lines.
 * Defaults to in-stock when the field is missing (legacy inventory JSON).
 */
export function isInventoryInStock(item: InventoryItem): boolean {
	return item.inStock !== false;
}

/** Normalised names of inventory items currently marked in stock. */
export function buildInStockNameSet(
	items: readonly InventoryItem[],
): Set<string> {
	const names = new Set<string>();
	for (const item of items) {
		if (!isInventoryInStock(item)) continue;
		const name = normaliseName(item.name);
		if (name) names.add(name);
	}
	return names;
}

/**
 * Drop grocery lines whose normalised name matches an in-stock inventory item.
 * Matching is name-only (units ignored) so staples like "garlic powder" work
 * regardless of how recipes write the unit.
 */
export function excludeInStockFromGrocery(
	items: GroceryItem[],
	inStockNames: Set<string>,
): GroceryItem[] {
	if (inStockNames.size === 0) return items;
	return items.filter(
		(item) => !inStockNames.has(normaliseName(item.name)),
	);
}
