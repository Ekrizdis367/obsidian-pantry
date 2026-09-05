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

	/** Delay (ms) before hover card appears on row mouseover. */
	private static readonly HOVER_CARD_DELAY_MS = 1500;
	/** Row density zoom step (±10%). */
	private static readonly ROW_SCALE_STEP = 0.1;
	/** Minimum row density scale. */
	private static readonly ROW_SCALE_MIN = 0.8;
	/** Maximum row density scale. */
	private static readonly ROW_SCALE_MAX = 1.4;

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
		this.hoverCardEl.addClass("is-hidden");

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
			text: "Pantry inventory",
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
			.setTooltip("Copy out-of-stock list to clipboard")
			.onClick(() => void this.exportOutOfStockList());

		const clearBtn = new ButtonComponent(actions)
			.setIcon("trash-2")
			.setTooltip("Clear inventory")
			.onClick(() => this.openClearConfirm());
		clearBtn.buttonEl.addClass("pantry-clear");
	}

	private renderZoomControls(parent: HTMLElement): void {
		const group = parent.createDiv({ cls: "pantry-zoom-controls" });

		const outBtn = group.createEl("button", {
			cls: "clickable-icon",
			attr: { title: "Zoom out" },
		});
		setIcon(outBtn, "zoom-out");
		outBtn.addEventListener("click", () => {
			const current = this.deps.getSettings().inventoryState.rowScale;
			void this.deps.manager.setRowScale(
				Math.max(InventoryView.ROW_SCALE_MIN, Math.round((current - InventoryView.ROW_SCALE_STEP) * 10) / 10),
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
				Math.min(InventoryView.ROW_SCALE_MAX, Math.round((current + InventoryView.ROW_SCALE_STEP) * 10) / 10),
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

		// Restore keyboard focus after a stock-toggle re-render.
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
		row.createSpan({ text: "In", cls: "pantry-col-right", attr: { title: "In stock" } });
		row.createSpan({ text: "Name" });
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
		li.addEventListener("keydown", (evt) => this.onRowKeydown(evt, li));
		li.addEventListener("mouseenter", () => this.scheduleHoverCard(li, item));
		li.addEventListener("mouseleave", () => this.cancelHoverCard());

		// Status indicator (color-coded icon)
		const status = getItemStatus(item);
		const statusIcon = li.createSpan({ cls: "pantry-item-status" });
		statusIcon.addClass(getStatusClass(status));
		setIcon(statusIcon, getStatusIcon(status));
		statusIcon.setAttribute("title", getStatusLabel(status));

		const stock = li.createEl("input", {
			cls: "pantry-inventory-stock",
			type: "checkbox",
			attr: {
				title: "In stock — when checked, matching grocery lines are omitted",
				"aria-label": "In stock",
			},
		});
		stock.checked = item.inStock !== false;
		stock.addEventListener("change", () => {
			void this.deps.manager.updateItem(item.id, {
				inStock: stock.checked,
			});
		});

		li.createSpan({
			cls: "pantry-name",
			text: toTitleCase(item.name),
		});

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

	/** Arrow keys move focus between rows. */
	private onRowKeydown(evt: KeyboardEvent, row: HTMLElement): void {
		switch (evt.key) {
			case "ArrowUp":
				evt.preventDefault();
				this.focusAdjacentRow(row, -1);
				break;
			case "ArrowDown":
				evt.preventDefault();
				this.focusAdjacentRow(row, 1);
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
		this.hoverCardEl.addClass("is-hidden");
	}

	/**
	 * Quick-glance details on hover — shop links are deliberately omitted.
	 * Card appears after HOVER_CARD_DELAY_MS, positioned below the row and nudged
	 * on-screen via requestAnimationFrame after rendering to get accurate size.
	 */
	private showHoverCard(row: HTMLElement, item: InventoryItem): void {
		const card = this.hoverCardEl;
		card.empty();
		card.removeClass("is-hidden");

		card.createDiv({ cls: "pantry-hover-card-title", text: toTitleCase(item.name) });

		const rows: Array<[string, string]> = [
			["In stock", item.inStock !== false ? "Yes" : "No"],
			["Category", item.category || "Uncategorized"],
		];
		if (item.unit) rows.push(["Unit", item.unit]);
		if (item.expirationDate) rows.push(["Expires", item.expirationDate]);
		if (item.tags.length) rows.push(["Tags", item.tags.join(", ")]);
		if (item.notes) rows.push(["Notes", item.notes]);

		for (const [label, value] of rows) {
			const r = card.createDiv({ cls: "pantry-hover-card-row" });
			r.createSpan({ cls: "pantry-hover-card-label", text: label });
			r.createSpan({ cls: "pantry-hover-card-value", text: value });
		}

		const rect = row.getBoundingClientRect();
		const left = `${rect.left}px`;
		const top = `${rect.bottom + 4}px`;
		card.style.setProperty("left", left);
		card.style.setProperty("top", top);

		// Position check: shift card on-screen if it overflows after the browser
		// renders its actual size. Use requestAnimationFrame to ensure layout is
		// computed before repositioning.
		window.requestAnimationFrame(() => {
			const cardRect = card.getBoundingClientRect();
			if (cardRect.right > window.innerWidth) {
				const nextLeft = `${Math.max(4, window.innerWidth - cardRect.width - 8)}px`;
				card.style.setProperty("left", nextLeft);
			}
			if (cardRect.bottom > window.innerHeight) {
				const nextTop = `${Math.max(4, rect.top - cardRect.height - 4)}px`;
				card.style.setProperty("top", nextTop);
			}
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

	/** Copy out-of-stock items (and their shop links) to the clipboard. */
	private async exportOutOfStockList(): Promise<void> {
		const outOfStock = this.deps.manager
			.getItems()
			.filter((item) => item.inStock === false);

		if (outOfStock.length === 0) {
			new Notice("Nothing marked out of stock.");
			return;
		}

		const lines: string[] = ["Out of stock:"];
		for (const item of outOfStock) {
			const unitSuffix = item.unit ? ` (${item.unit})` : "";
			lines.push(`- ${toTitleCase(item.name)}${unitSuffix}`);
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
				`Copied out-of-stock list (${outOfStock.length} item${outOfStock.length === 1 ? "" : "s"}) to clipboard.`,
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
