import { App, Events } from "obsidian";
import { InventoryItem } from "../types";
import { PantrySettings } from "../settings";
import { groupForDisplay } from "./aggregator";

export interface InventorySaveSink {
	readonly settings: PantrySettings;
	save(): Promise<void>;
}

/**
 * Manages the user's pantry inventory. Broadcasts change events so views can
 * re-render. Persistence funnels through `sink.save()`, which writes inventory
 * state to a vault JSON file.
 */
export class InventoryManager extends Events {
	private items: InventoryItem[] = [];
	private rebuildPromise: Promise<void> | null = null;

	constructor(
		private readonly app: App,
		private readonly sink: InventorySaveSink,
	) {
		super();
	}

	getItems(): InventoryItem[] {
		return this.items;
	}

	/**
	 * Get items grouped by category for display.
	 */
	getGroupedItems(
		settings: PantrySettings,
	): Array<[string, InventoryItem[]]> {
		return groupForDisplay(this.items as any, settings) as any;
	}

	/**
	 * Add a new inventory item.
	 */
	async addItem(item: InventoryItem): Promise<void> {
		this.items.push(item);
		await this.sink.save();
		this.trigger("changed");
	}

	/**
	 * Update an existing inventory item by id.
	 */
	async updateItem(id: string, updates: Partial<InventoryItem>): Promise<void> {
		const item = this.items.find((i) => i.id === id);
		if (!item) return;
		Object.assign(item, updates);
		await this.sink.save();
		this.trigger("changed");
	}

	/**
	 * Remove an inventory item by id.
	 */
	async removeItem(id: string): Promise<void> {
		this.items = this.items.filter((i) => i.id !== id);
		await this.sink.save();
		this.trigger("changed");
	}

	/**
	 * Update the collapsed state of a category group.
	 */
	async setGroupCollapsed(
		groupName: string,
		collapsed: boolean,
	): Promise<void> {
		if (collapsed) {
			this.sink.settings.inventoryState.collapsedGroups[groupName] =
				true;
		} else {
			delete this.sink.settings.inventoryState.collapsedGroups[groupName];
		}
		await this.sink.save();
		this.trigger("changed");
	}

	/**
	 * Check if a category group is collapsed.
	 */
	isGroupCollapsed(groupName: string): boolean {
		return (
			this.sink.settings.inventoryState.collapsedGroups[groupName] ??
			false
		);
	}

	/**
	 * Load inventory from the saved state.
	 */
	async refresh(): Promise<void> {
		if (this.rebuildPromise) {
			return this.rebuildPromise;
		}

		this.rebuildPromise = this.rebuild().finally(() => {
			this.rebuildPromise = null;
		});

		return this.rebuildPromise;
	}

	private async rebuild(): Promise<void> {
		this.items = [...this.sink.settings.inventoryState.items];
		this.trigger("changed");
	}

	/**
	 * Clear all inventory items.
	 */
	async clear(): Promise<void> {
		this.items = [];
		this.sink.settings.inventoryState.items = [];
		await this.sink.save();
		this.trigger("changed");
	}
}
