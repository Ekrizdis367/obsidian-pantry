import {
	ButtonComponent,
	EventRef,
	ItemView,
	Notice,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import { InventoryManager } from "../grocery/inventory-manager";
import { formatQuantity } from "../parser/quantity";
import { PantrySettings } from "../settings";
import { InventoryItem } from "../types";
import { toTitleCase } from "../utils/text";
import { AddItemModal } from "./add-inventory-item-modal";
import { ConfirmModal } from "./confirm-modal";

export const VIEW_TYPE_INVENTORY = "pantry-inventory";

interface ViewDeps {
	manager: InventoryManager;
	getSettings: () => PantrySettings;
	saveSettings: () => Promise<void>;
}

export class InventoryView extends ItemView {
	private listEl!: HTMLElement;
	private headerEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private changedRef: EventRef | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: ViewDeps,
	) {
		super(leaf);
		this.icon = "archive";
		this.navigation = true;
	}

	getViewType(): string {
		return VIEW_TYPE_INVENTORY;
	}

	getDisplayText(): string {
		return "Inventory";
	}

	async onOpen(): Promise<void> {
		const root = this.containerEl.children[1];
		if (!root) return;
		root.empty();
		root.addClass("pantry-view");

		this.headerEl = root.createDiv({ cls: "pantry-header" });
		this.summaryEl = root.createDiv({ cls: "pantry-summary" });
		this.listEl = root.createDiv({ cls: "pantry-inventory-list" });

		this.renderHeader();

		this.changedRef = this.deps.manager.on("changed", () => {
			this.renderList();
		});

		await this.deps.manager.refresh();
		this.renderList();
	}

	onClose(): Promise<void> {
		if (this.changedRef) {
			this.deps.manager.offref(this.changedRef);
		}
		return Promise.resolve();
	}

	private renderHeader(): void {
		this.headerEl.empty();

		const titleWrap = this.headerEl.createDiv({
			cls: "pantry-header-content",
		});
		titleWrap.createEl("h2", {
			text: "Pantry Inventory",
			cls: "pantry-title",
		});

		const actions = this.headerEl.createDiv({ cls: "pantry-actions" });

		const addBtn = new ButtonComponent(actions)
			.setButtonText("Add item")
			.onClick(() => this.openAddItemModal());
		addBtn.buttonEl.addClass("pantry-add");

		const clearBtn = new ButtonComponent(actions)
			.setIcon("trash-2")
			.setTooltip("Clear all inventory")
			.onClick(() => this.openClearConfirm());
		clearBtn.buttonEl.addClass("pantry-clear");
	}

	private renderList(): void {
		this.listEl.empty();

		const items = this.deps.manager.getItems();
		const groupedItems = this.deps.manager.getGroupedItems(
			this.deps.getSettings(),
		);

		// Render summary
		this.summaryEl.empty();
		this.summaryEl.createEl("p", {
			text: `${items.length} item${items.length !== 1 ? "s" : ""} in inventory`,
		});

		if (items.length === 0) {
			this.listEl.createDiv({
				cls: "pantry-empty",
				text: "No items in inventory yet. Add some to get started.",
			});
			return;
		}

		// Render grouped items
		for (const [category, categoryItems] of groupedItems) {
			if (categoryItems.length === 0) continue;

			const group = this.listEl.createDiv({
				cls: `pantry-group${
					this.deps.manager.isGroupCollapsed(category)
						? " is-collapsed"
						: ""
				}`,
			});

			// Group header
			const header = group.createEl("button", {
				cls: "pantry-group-header",
			});
			header.addEventListener("click", () =>
				this.toggleGroupCollapsed(category),
			);

			const chevron = header.createSpan({ cls: "pantry-chevron" });
			setIcon(chevron, "chevron-down");

			header.createEl("h3", {
				text: category,
				cls: "pantry-group-title",
			});

			const count = header.createSpan({
				cls: "pantry-group-count",
				text: String(categoryItems.length),
			});

			// Items list
			const itemsList = group.createEl("ul", { cls: "pantry-items" });
			for (const item of categoryItems) {
				this.renderItem(itemsList, item);
			}
		}
	}

	private renderItem(container: HTMLElement, item: InventoryItem): void {
		const li = container.createEl("li", { cls: "pantry-item" });

		const body = li.createDiv({ cls: "pantry-item-body" });

		const main = body.createDiv({ cls: "pantry-item-main" });

		const nameSpan = main.createSpan({
			cls: "pantry-name",
			text: toTitleCase(item.name),
		});

		// Quantity
		if (item.quantity !== null || item.unit) {
			const qtyText =
				item.quantity !== null
					? formatQuantity(item.quantity) + (item.unit ? " " + item.unit : "")
					: item.unit || "";
			const qty = main.createSpan({
				cls: "pantry-qty",
				text: qtyText,
			});
			qty.style.marginLeft = "0.5em";
		}

		// Meta info (date added, expiration)
		if (item.expirationDate || item.notes) {
			const meta = body.createDiv({ cls: "pantry-meta" });
			const parts: string[] = [];

			if (item.expirationDate) {
				parts.push(`Expires: ${item.expirationDate}`);
			}
			if (item.notes) {
				parts.push(`Notes: ${item.notes}`);
			}

			meta.setText(parts.join(" • "));
		}

		// Action buttons
		const actions = li.createDiv({ cls: "pantry-item-actions" });

		const editBtn = actions.createEl("button", {
			cls: "clickable-icon",
			attr: { title: "Edit item" },
		});
		setIcon(editBtn, "pencil");
		editBtn.addEventListener("click", () => this.openEditItemModal(item));

		const removeBtn = actions.createEl("button", {
			cls: "clickable-icon pantry-remove",
			attr: { title: "Remove item" },
		});
		setIcon(removeBtn, "trash-2");
		removeBtn.addEventListener("click", () => this.removeItem(item.id));
	}

	private toggleGroupCollapsed(category: string): void {
		const isCollapsed =
			this.deps.manager.isGroupCollapsed(category);
		void this.deps.manager.setGroupCollapsed(category, !isCollapsed);
	}

	private openAddItemModal(): void {
		new AddItemModal(this.app, async (item) => {
			try {
				await this.deps.manager.addItem(item);
				new Notice(`Added ${item.name} to inventory`);
			} catch (e) {
				new Notice(`Error adding item: ${String(e)}`);
			}
		}).open();
	}

	private openEditItemModal(item: InventoryItem): void {
		new AddItemModal(
			this.app,
			async (updatedItem) => {
				try {
					await this.deps.manager.updateItem(item.id, updatedItem);
					new Notice(`Updated ${updatedItem.name}`);
				} catch (e) {
					new Notice(`Error updating item: ${String(e)}`);
				}
			},
			item,
		).open();
	}

	private removeItem(id: string): void {
		new ConfirmModal(this.app, {
			title: "Remove item",
			message:
				"Are you sure you want to remove this item from inventory?",
			confirmText: "Remove",
			destructive: true,
			onConfirm: async () => {
				try {
					await this.deps.manager.removeItem(id);
					new Notice("Item removed from inventory");
				} catch (e) {
					new Notice(`Error removing item: ${String(e)}`);
				}
			},
		}).open();
	}

	private openClearConfirm(): void {
		new ConfirmModal(this.app, {
			title: "Clear all inventory",
			message:
				"Are you sure you want to remove all items from inventory? This cannot be undone.",
			confirmText: "Clear all",
			destructive: true,
			onConfirm: async () => {
				try {
					await this.deps.manager.clear();
					new Notice("Inventory cleared");
				} catch (e) {
					new Notice(`Error clearing inventory: ${String(e)}`);
				}
			},
		}).open();
	}
}
