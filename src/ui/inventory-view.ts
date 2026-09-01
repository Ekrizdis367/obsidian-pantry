import {
	ButtonComponent,
	EventRef,
	ItemView,
	Menu,
	Notice,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import { InventoryManager } from "../grocery/inventory-manager";
import { PantrySettings } from "../settings";
import { InventoryItem } from "../types";
import { toTitleCase } from "../utils/text";
import {
	getItemStatus,
	getStatusClass,
	getStatusIcon,
	getStatusLabel,
	ItemStatus,
} from "../utils/inventory-status";
import { renderShopLinkButtons } from "./shop-link-buttons";
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
	/** Item id to refocus after a re-render triggered by keyboard/stepper edits. */
	private focusedItemId: string | null = null;
	/** Shared floating panel showing item details on hover. */
	private hoverCardEl!: HTMLElement;
	private hoverTimer: number | null = null;
	private zoomLabelEl!: HTMLElement;

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

		this.hoverCardEl = document.body.createDiv({ cls: "pantry-hover-card" });
		this.hoverCardEl.style.display = "none";

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
		this.cancelHoverCard();
		this.hoverCardEl.remove();
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

		new ButtonComponent(actions)
			.setIcon("layers")
			.setTooltip("Group by")
			.onClick((evt) => this.openGroupByMenu(evt));

		this.renderZoomControls(actions);

		new ButtonComponent(actions)
			.setIcon("clipboard-list")
			.setTooltip("Copy restock list to clipboard")
			.onClick(() => void this.exportRestockList());

		const clearBtn = new ButtonComponent(actions)
			.setIcon("trash-2")
			.setTooltip("Clear all inventory")
			.onClick(() => this.openClearConfirm());
		clearBtn.buttonEl.addClass("pantry-clear");
	}

	private renderZoomControls(parent: HTMLElement): void {
		const ROW_SCALE_STEP = 0.1;
		const ROW_SCALE_MIN = 0.8;
		const ROW_SCALE_MAX = 1.4;

		const group = parent.createDiv({ cls: "pantry-zoom-controls" });

		const outBtn = group.createEl("button", {
			cls: "clickable-icon",
			attr: { title: "Zoom out" },
		});
		setIcon(outBtn, "zoom-out");
		outBtn.addEventListener("click", () => {
			const current = this.deps.getSettings().inventoryState.rowScale;
			void this.deps.manager.setRowScale(
				Math.max(ROW_SCALE_MIN, Math.round((current - ROW_SCALE_STEP) * 10) / 10),
			);
		});

		const label = group.createSpan({ cls: "pantry-zoom-label" });
		label.setAttribute("title", "Reset zoom");
		label.addEventListener("click", () => {
			void this.deps.manager.setRowScale(1);
		});
		this.zoomLabelEl = label;

		const inBtn = group.createEl("button", {
			cls: "clickable-icon",
			attr: { title: "Zoom in" },
		});
		setIcon(inBtn, "zoom-in");
		inBtn.addEventListener("click", () => {
			const current = this.deps.getSettings().inventoryState.rowScale;
			void this.deps.manager.setRowScale(
				Math.min(ROW_SCALE_MAX, Math.round((current + ROW_SCALE_STEP) * 10) / 10),
			);
		});
	}

	private openGroupByMenu(evt: MouseEvent): void {
		const menu = new Menu();
		const current = this.deps.getSettings().inventoryState.groupBy;
		const options: Array<["category" | "tag", string]> = [
			["category", "By category"],
			["tag", "By tag"],
		];
		for (const [value, label] of options) {
			menu.addItem((item) =>
				item
					.setTitle(label)
					.setChecked(current === value)
					.onClick(() => {
						void this.deps.manager.setGroupBy(value);
					}),
			);
		}
		menu.showAtMouseEvent(evt);
	}

	private renderList(): void {
		this.listEl.empty();

		const items = this.deps.manager.getItems();
		const groupedItems = this.deps.manager.getGroupedItems(
			this.deps.getSettings(),
		);
		const rowScale = this.deps.getSettings().inventoryState.rowScale;
		this.listEl.style.setProperty("zoom", String(rowScale));
		this.zoomLabelEl.setText(`${Math.round(rowScale * 100)}%`);

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

		this.renderColumnHeader();

		// Render grouped items
		for (const [groupName, groupItems] of groupedItems) {
			if (groupItems.length === 0) continue;

			const group = this.listEl.createDiv({
				cls: `pantry-group${
					this.deps.manager.isGroupCollapsed(groupName)
						? " is-collapsed"
						: ""
				}`,
			});

			// Group header
			const header = group.createEl("button", {
				cls: "pantry-group-header",
			});
			header.addEventListener("click", () =>
				this.toggleGroupCollapsed(groupName),
			);

			const chevron = header.createSpan({ cls: "pantry-chevron" });
			setIcon(chevron, "chevron-down");

			header.createEl("h3", {
				text: groupName,
				cls: "pantry-group-title",
			});

			header.createSpan({
				cls: "pantry-group-count",
				text: String(groupItems.length),
			});

			// Items list
			const itemsList = group.createEl("ul", { cls: "pantry-items" });
			for (const item of groupItems) {
				this.renderItem(itemsList, item);
			}
		}

		// Restore keyboard focus after a stepper/keyboard-driven re-render.
		if (this.focusedItemId) {
			const row = this.listEl.querySelector<HTMLElement>(
				`[data-item-id="${CSS.escape(this.focusedItemId)}"]`,
			);
			row?.focus({ preventScroll: true });
		}
	}

	/** Column titles matching each row's grid layout, for a spreadsheet-like look. */
	private renderColumnHeader(): void {
		const row = this.listEl.createDiv({ cls: "pantry-item-grid pantry-column-header" });
		row.createSpan(); // status column
		row.createSpan({ text: "Name" });
		row.createSpan({ text: "Have", cls: "pantry-col-right" });
		row.createSpan({ text: "Want", cls: "pantry-col-right" });
		row.createSpan({ text: "Unit" });
		row.createSpan({ text: "Shops" });
		row.createSpan(); // actions column
	}

	private renderItem(container: HTMLElement, item: InventoryItem): void {
		const li = container.createEl("li", {
			cls: "pantry-item pantry-item-grid",
			attr: { tabindex: "0" },
		});
		li.dataset.itemId = item.id;

		li.addEventListener("focus", () => {
			this.focusedItemId = item.id;
		});
		li.addEventListener("keydown", (evt) => this.onRowKeydown(evt, li, item));
		li.addEventListener("mouseenter", () => this.scheduleHoverCard(li, item));
		li.addEventListener("mouseleave", () => this.cancelHoverCard());

		// Status indicator (color-coded icon)
		const status = getItemStatus(item);
		const statusIcon = li.createSpan({ cls: "pantry-item-status" });
		statusIcon.addClass(getStatusClass(status));
		setIcon(statusIcon, getStatusIcon(status));
		statusIcon.setAttribute("title", getStatusLabel(status));

		li.createSpan({
			cls: "pantry-name",
			text: toTitleCase(item.name),
		});

		this.renderQtyStepper(li, item, "quantity");
		this.renderQtyStepper(li, item, "desiredQuantity");

		li.createSpan({ cls: "pantry-unit", text: item.unit || "—" });

		const shopsEl = li.createDiv({ cls: "pantry-shop-links" });
		renderShopLinkButtons(shopsEl, item.shopLinks);

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

	/** Arrow keys move focus and adjust quantities without leaving the keyboard. */
	private onRowKeydown(evt: KeyboardEvent, row: HTMLElement, item: InventoryItem): void {
		switch (evt.key) {
			case "ArrowUp":
				evt.preventDefault();
				this.focusAdjacentRow(row, -1);
				break;
			case "ArrowDown":
				evt.preventDefault();
				this.focusAdjacentRow(row, 1);
				break;
			case "ArrowLeft":
				evt.preventDefault();
				this.adjustQuantity(
					item,
					evt.shiftKey ? "desiredQuantity" : "quantity",
					-1,
				);
				break;
			case "ArrowRight":
				evt.preventDefault();
				this.adjustQuantity(
					item,
					evt.shiftKey ? "desiredQuantity" : "quantity",
					1,
				);
				break;
		}
	}

	private focusAdjacentRow(current: HTMLElement, delta: number): void {
		const rows = Array.from(
			this.listEl.querySelectorAll<HTMLElement>(
				".pantry-group:not(.is-collapsed) .pantry-item",
			),
		);
		const idx = rows.indexOf(current);
		if (idx === -1) return;
		const next = rows[idx + delta];
		next?.focus();
	}

	private static readonly HOVER_CARD_DELAY_MS = 1500;

	private scheduleHoverCard(row: HTMLElement, item: InventoryItem): void {
		this.cancelHoverCard();
		this.hoverTimer = window.setTimeout(() => {
			this.showHoverCard(row, item);
		}, InventoryView.HOVER_CARD_DELAY_MS);
	}

	private cancelHoverCard(): void {
		if (this.hoverTimer !== null) {
			window.clearTimeout(this.hoverTimer);
			this.hoverTimer = null;
		}
		this.hoverCardEl.style.display = "none";
	}

	/** Quick-glance details on hover — shop links are deliberately omitted. */
	private showHoverCard(row: HTMLElement, item: InventoryItem): void {
		const card = this.hoverCardEl;
		card.empty();

		card.createDiv({ cls: "pantry-hover-card-title", text: toTitleCase(item.name) });

		const rows: Array<[string, string]> = [
			["Category", item.category || "Uncategorized"],
			[
				"Quantity",
				`${item.quantity ?? 0} have / ${item.desiredQuantity ?? 0} want${
					item.unit ? ` (${item.unit})` : ""
				}`,
			],
		];
		if (item.expirationDate) rows.push(["Expires", item.expirationDate]);
		if (item.tags.length) rows.push(["Tags", item.tags.join(", ")]);
		if (item.notes) rows.push(["Notes", item.notes]);

		for (const [label, value] of rows) {
			const r = card.createDiv({ cls: "pantry-hover-card-row" });
			r.createSpan({ cls: "pantry-hover-card-label", text: label });
			r.createSpan({ cls: "pantry-hover-card-value", text: value });
		}

		const rect = row.getBoundingClientRect();
		card.style.display = "block";
		card.style.left = `${rect.left}px`;
		card.style.top = `${rect.bottom + 4}px`;

		// Keep the card on-screen once its rendered size is known.
		requestAnimationFrame(() => {
			const cardRect = card.getBoundingClientRect();
			if (cardRect.right > window.innerWidth) {
				card.style.left = `${Math.max(4, window.innerWidth - cardRect.width - 8)}px`;
			}
			if (cardRect.bottom > window.innerHeight) {
				card.style.top = `${Math.max(4, rect.top - cardRect.height - 4)}px`;
			}
		});
	}

	private adjustQuantity(
		item: InventoryItem,
		field: "quantity" | "desiredQuantity",
		delta: number,
	): void {
		this.focusedItemId = item.id;
		this.cancelHoverCard();
		const next = Math.max(0, (item[field] ?? 0) + delta);
		void this.deps.manager.updateItem(item.id, { [field]: next });
	}

	/** Render a compact +/- stepper bound to a numeric field on an item. */
	private renderQtyStepper(
		parent: HTMLElement,
		item: InventoryItem,
		field: "quantity" | "desiredQuantity",
	): void {
		const fieldLabel = field === "quantity" ? "current" : "desired";
		const group = parent.createDiv({ cls: "pantry-qty-stepper" });

		const minusBtn = group.createEl("button", {
			cls: "clickable-icon pantry-qty-btn",
			attr: { title: `Decrease ${fieldLabel} quantity` },
		});
		setIcon(minusBtn, "minus");

		const input = group.createEl("input", {
			cls: "pantry-qty-input",
			type: "number",
			attr: { min: "0", step: "1" },
		});
		input.value = String(item[field] ?? 0);

		const plusBtn = group.createEl("button", {
			cls: "clickable-icon pantry-qty-btn",
			attr: { title: `Increase ${fieldLabel} quantity` },
		});
		setIcon(plusBtn, "plus");

		const commit = (value: number) => {
			this.focusedItemId = item.id;
			this.cancelHoverCard();
			const clamped = Math.max(0, value);
			void this.deps.manager.updateItem(item.id, { [field]: clamped });
		};

		minusBtn.addEventListener("click", () => {
			commit((item[field] ?? 0) - 1);
		});
		plusBtn.addEventListener("click", () => {
			commit((item[field] ?? 0) + 1);
		});
		input.addEventListener("change", () => {
			const parsed = parseFloat(input.value);
			commit(!isNaN(parsed) ? parsed : 0);
		});
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

	/** Copy a restock list (low/out of stock items + their shop links) to the clipboard. */
	private async exportRestockList(): Promise<void> {
		const restock = this.deps.manager
			.getItems()
			.filter((item) => {
				const status = getItemStatus(item);
				return status === ItemStatus.OUT_OF_STOCK || status === ItemStatus.LOW;
			});

		if (restock.length === 0) {
			new Notice("Nothing to restock right now.");
			return;
		}

		const lines: string[] = ["Restock list:"];
		for (const item of restock) {
			const have = item.quantity ?? 0;
			const want = item.desiredQuantity ?? 0;
			const missing = Math.max(0, want - have);
			const unitSuffix = item.unit ? ` ${item.unit}` : "";
			lines.push(
				`- ${toTitleCase(item.name)}: need ${missing}${unitSuffix} (have ${have}, want ${want})`,
			);
			if (item.shopLinks.length > 0) {
				const shopText = item.shopLinks
					.map((l) => `${l.nickname || "Shop"}: ${l.url}`)
					.join(" | ");
				lines.push(`  Shops: ${shopText}`);
			}
		}

		try {
			await navigator.clipboard.writeText(lines.join("\n"));
			new Notice(
				`Copied restock list (${restock.length} item${restock.length === 1 ? "" : "s"}) to clipboard.`,
			);
		} catch (e) {
			new Notice(`Could not copy to clipboard: ${String(e)}`);
		}
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
