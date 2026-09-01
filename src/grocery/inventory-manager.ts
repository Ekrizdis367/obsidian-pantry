import { App, Events } from "obsidian";
import { InventoryItem } from "../types";
import { PantrySettings } from "../settings";

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
	 * Get items grouped by category or tag, per the saved grouping mode.
	 * Untagged items fall into an "Untagged" group when grouping by tag; an
	 * item with multiple tags appears in each of its tag groups.
	 */
	getGroupedItems(
		settings: PantrySettings,
	): Array<[string, InventoryItem[]]> {
		const groupBy = settings.inventoryState.groupBy;
		const sorted = [...this.items].sort((a, b) =>
			a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
		);

		const groups = new Map<string, InventoryItem[]>();
		for (const item of sorted) {
			const keys =
				groupBy === "tag"
					? item.tags.length > 0
						? item.tags
						: ["Untagged"]
					: [item.category || "Other"];
			for (const key of keys) {
				const arr = groups.get(key);
				if (arr) arr.push(item);
				else groups.set(key, [item]);
			}
		}

		if (groupBy === "tag") {
			return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
		}

		const order = settings.categoryOrder.length ? settings.categoryOrder : [];
		const orderedKeys = order.filter((key) => groups.has(key));
		const remaining = [...groups.keys()]
			.filter((k) => !orderedKeys.includes(k))
			.sort();
		return [...orderedKeys, ...remaining].map((k) => [k, groups.get(k) ?? []]);
	}

	/** Set how inventory items are grouped, then persist and re-render. */
	async setGroupBy(groupBy: "category" | "tag"): Promise<void> {
		this.sink.settings.inventoryState.groupBy = groupBy;
		await this.sink.save();
		this.trigger("changed");
	}

	/** Set the inventory view's row density (zoom), then persist and re-render. */
	async setRowScale(scale: number): Promise<void> {
		this.sink.settings.inventoryState.rowScale = scale;
		await this.sink.save();
		this.trigger("changed");
	}

	/**
	 * Add a new inventory item.
	 */
	async addItem(item: InventoryItem): Promise<void> {
		this.items.push(item);
		this.sink.settings.inventoryState.items = this.items;
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
		this.sink.settings.inventoryState.items = this.items;
		await this.sink.save();
		this.trigger("changed");
	}

	/**
	 * Remove an inventory item by id.
	 */
	async removeItem(id: string): Promise<void> {
		this.items = this.items.filter((i) => i.id !== id);
		this.sink.settings.inventoryState.items = this.items;
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
