import { InventoryItem } from "../types";

/** Inventory item status for visual flagging. */
export enum ItemStatus {
	/** Item is marked out of stock (In unchecked). */
	OUT_OF_STOCK = "out-of-stock",
	/** Item has expired. */
	EXPIRED = "expired",
	/** Item is expiring soon (within threshold days). */
	EXPIRING_SOON = "expiring-soon",
	/** Item is in stock and not expiration-flagged. */
	OK = "ok",
}

/** Configuration for status calculation. */
export interface StatusConfig {
	/** Days until expiration considered "soon" (default: 7). */
	expiringThresholdDays: number;
}

const DEFAULT_CONFIG: StatusConfig = {
	expiringThresholdDays: 7,
};

/**
 * Determine the status of an inventory item.
 * Stock level is the In checkbox; expiration dates still apply when set.
 */
export function getItemStatus(
	item: InventoryItem,
	config: StatusConfig = DEFAULT_CONFIG,
): ItemStatus {
	if (item.inStock === false) {
		return ItemStatus.OUT_OF_STOCK;
	}

	if (item.expirationDate) {
		const expDate = new Date(item.expirationDate);
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		if (expDate < today) {
			return ItemStatus.EXPIRED;
		}

		const expiringDate = new Date(today);
		expiringDate.setDate(
			expiringDate.getDate() + config.expiringThresholdDays,
		);
		if (expDate < expiringDate) {
			return ItemStatus.EXPIRING_SOON;
		}
	}

	return ItemStatus.OK;
}

/** Get CSS class for status color. */
export function getStatusClass(status: ItemStatus): string {
	switch (status) {
		case ItemStatus.OUT_OF_STOCK:
		case ItemStatus.EXPIRED:
			return "pantry-status-danger";
		case ItemStatus.EXPIRING_SOON:
			return "pantry-status-warning";
		default:
			return "pantry-status-ok";
	}
}

/** Get human-readable status label. */
export function getStatusLabel(status: ItemStatus): string {
	switch (status) {
		case ItemStatus.OUT_OF_STOCK:
			return "Out of stock";
		case ItemStatus.EXPIRED:
			return "Expired";
		case ItemStatus.EXPIRING_SOON:
			return "Expiring soon";
		default:
			return "In stock";
	}
}

/** Get icon name for status. */
export function getStatusIcon(status: ItemStatus): string {
	switch (status) {
		case ItemStatus.OUT_OF_STOCK:
			return "circle-x";
		case ItemStatus.EXPIRED:
			return "alert-circle";
		case ItemStatus.EXPIRING_SOON:
			return "clock-alert";
		default:
			return "check-circle-2";
	}
}
