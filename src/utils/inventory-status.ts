import { InventoryItem } from "../types";

/** Inventory item status for visual flagging. */
export enum ItemStatus {
	/** Item is out of stock (quantity 0 or null). */
	OUT_OF_STOCK = "out-of-stock",
	/** Item has expired. */
	EXPIRED = "expired",
	/** Item quantity is low (below threshold). */
	LOW = "low",
	/** Item is expiring soon (within threshold days). */
	EXPIRING_SOON = "expiring-soon",
	/** Item is in good condition. */
	OK = "ok",
}

/** Configuration for status calculation. */
export interface StatusConfig {
	/** Days until expiration considered "soon" (default: 7). */
	expiringThresholdDays: number;
	/** Quantity below which is considered "low" (default: 5). */
	lowStockThreshold: number;
}

const DEFAULT_CONFIG: StatusConfig = {
	expiringThresholdDays: 7,
	lowStockThreshold: 5,
};

/**
 * Determine the status of an inventory item.
 * Returns the highest-priority status (out of stock > expired > low > ok).
 * Low stock is defined as: current < (desired / 2)
 */
export function getItemStatus(
	item: InventoryItem,
	config: StatusConfig = DEFAULT_CONFIG,
): ItemStatus {
	// Check if out of stock (highest priority - red)
	if (item.quantity === null || item.quantity === 0) {
		return ItemStatus.OUT_OF_STOCK;
	}

	// Check if expired (red)
	if (item.expirationDate) {
		const expDate = new Date(item.expirationDate);
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		if (expDate < today) {
			return ItemStatus.EXPIRED;
		}

		// Check if expiring soon (yellow)
		const expiringDate = new Date(today);
		expiringDate.setDate(
			expiringDate.getDate() + config.expiringThresholdDays,
		);
		if (expDate < expiringDate) {
			return ItemStatus.EXPIRING_SOON;
		}
	}

	// Check if low stock (yellow)
	// Low = current quantity is less than half of desired quantity
	if (item.desiredQuantity && item.desiredQuantity > 0) {
		const lowThreshold = item.desiredQuantity / 2;
		if (item.quantity < lowThreshold) {
			return ItemStatus.LOW;
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
		case ItemStatus.LOW:
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
		case ItemStatus.LOW:
			return "Low stock";
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
		case ItemStatus.LOW:
			return "alert-triangle";
		case ItemStatus.EXPIRING_SOON:
			return "clock-alert";
		default:
			return "check-circle-2";
	}
}
