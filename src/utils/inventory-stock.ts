import { normaliseName } from "../parser/ingredient";
import { GroceryItem, InventoryItem } from "../types";

/** Whether an inventory item currently has any of it on hand. */
export function isInventoryInStock(item: InventoryItem): boolean {
	return (item.quantity || 0) > 0;
}

/** Normalised names of inventory items with a have quantity above zero. */
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
