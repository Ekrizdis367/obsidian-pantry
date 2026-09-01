import { ShoppingStore } from "../settings";

/**
 * Build the URL opened by an item's cart button. Appends the highest
 * priority configured store's id as a retailer hint query param, since
 * Instacart has no public cart API to target a specific store directly.
 */
export function buildCartUrl(
	itemUrl: string,
	stores: ShoppingStore[],
): string {
	const topStore = stores[0];
	if (!topStore) return itemUrl;

	const separator = itemUrl.includes("?") ? "&" : "?";
	return `${itemUrl}${separator}retailer_key=${encodeURIComponent(topStore.id)}`;
}
