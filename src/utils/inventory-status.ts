import { InventoryItem } from "../types";

/** Inventory item status for visual flagging. */
export enum ItemStatus {
	/** Item is out of stock relative to a configured desired quantity. */
	OUT_OF_STOCK = "out-of-stock",
	/** Item has expired. */
	EXPIRED = "expired",
	/** Item quantity is low (below threshold). */
	LOW = "low",
	/** Item is expiring soon (within threshold days). */
	EXPIRING_SOON = "expiring-soon",
	/** No desired quantity is set, so stock level isn't being tracked. */
	UNTRACKED = "untracked",
	/** Item is in good condition. */
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
 * A desired quantity of 0/null means the item isn't being stock-tracked, so
 * it's never flagged as out of stock or low — only expiration still applies.
 */
export function getItemStatus(
	item: InventoryItem,
	config: StatusConfig = DEFAULT_CONFIG,
): ItemStatus {
	const isTracked = item.desiredQuantity !== null && item.desiredQuantity > 0;

	if (isTracked && (item.quantity === null || item.quantity === 0)) {
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

	if (isTracked) {
		const lowThreshold = (item.desiredQuantity as number) / 2;
		if ((item.quantity ?? 0) < lowThreshold) {
			return ItemStatus.LOW;
		}
		return ItemStatus.OK;
	}

	if (item.quantity === null || item.quantity === 0) {
		return ItemStatus.UNTRACKED;
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
		case ItemStatus.UNTRACKED:
			return "pantry-status-neutral";
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
		case ItemStatus.UNTRACKED:
			return "Not tracked";
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
		case ItemStatus.UNTRACKED:
			return "circle-dashed";
		default:
			return "check-circle-2";
	}
}
