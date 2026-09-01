import { ShoppingStore } from "../settings";

/**
 * Build the URL opened by an item's cart button.
 *
 * Instacart product URLs carry an undocumented `retailerSlug` query param
 * (e.g. `?retailerSlug=safeway`) that selects which retailer's listing to
 * show. It's not part of Instacart's public Developer Platform API — just an
 * observed behavior of their website — so it may change without notice.
 * Swapping the slug also only works if the pasted product's underlying ID
 * exists in that retailer's catalog; retailers don't share product IDs, so
 * this can't reliably retarget a link to an arbitrary store.
 *
 * With no stores configured, the item's URL is opened unmodified.
 */
export function buildCartUrl(
	itemUrl: string,
	stores: ShoppingStore[],
): string {
	const topStore = stores[0];
	if (!topStore) return itemUrl;

	try {
		const url = new URL(itemUrl);
		url.searchParams.set("retailerSlug", topStore.id);
		return url.toString();
	} catch {
		const separator = itemUrl.includes("?") ? "&" : "?";
		return `${itemUrl}${separator}retailerSlug=${encodeURIComponent(topStore.id)}`;
	}
}
