import {
	ButtonComponent,
	EventRef,
	ItemView,
	Menu,
	Notice,
	TFile,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import { groupForDisplay } from "../grocery/aggregator";
import { GroceryListManager } from "../grocery/manager";
import { InventoryManager } from "../grocery/inventory-manager";
import { formatQuantity } from "../parser/quantity";
import { readRecipeMultiplier } from "../parser/recipe";
import {
	matchingAllergens,
	readAllergens,
} from "../parser/recipe-meta";
import { PantrySettings } from "../settings";
import { GroceryItem, OneOffItem, InventoryItem } from "../types";
import { toTitleCase } from "../utils/text";
import {
	getItemStatus,
	getStatusClass,
	getStatusIcon,
	getStatusLabel,
} from "../utils/inventory-status";
import { renderShopLinkButtons } from "./shop-link-buttons";
import { AddOneOffModal } from "./add-item-modal";
import { ConfirmModal } from "./confirm-modal";
import { ExportListModal } from "./export-modal";
import { MealPlanPickerModal } from "./meal-plan-picker";

export const VIEW_TYPE_GROCERY_LIST = "pantry-grocery-list";

interface ViewDeps {
	manager: GroceryListManager;
	inventoryManager: InventoryManager;
	getSettings: () => PantrySettings;
	saveSettings: () => Promise<void>;
}

export class GroceryListView extends ItemView {
	private listEl!: HTMLElement;
	private headerEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private recipesEl!: HTMLElement;
	private changedRef: EventRef | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: ViewDeps,
	) {
		super(leaf);
		this.icon = "shopping-cart";
		this.navigation = true;
	}

	getViewType(): string {
		return VIEW_TYPE_GROCERY_LIST;
	}

	getDisplayText(): string {
		return "Grocery list";
	}

	async onOpen(): Promise<void> {
		const root = this.containerEl.children[1];
		if (!root) return;
		root.empty();
		root.addClass("pantry-view");

		this.headerEl = root.createDiv({ cls: "pantry-header" });
		this.summaryEl = root.createDiv({ cls: "pantry-summary" });
		this.recipesEl = root.createDiv({ cls: "pantry-recipes" });
		this.listEl = root.createDiv({ cls: "pantry-list" });

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
			this.changedRef = null;
		}
		return Promise.resolve();
	}

	private renderHeader(): void {
		this.headerEl.empty();

		const titleEl = this.headerEl.createDiv({ cls: "pantry-title" });
		titleEl.createSpan({ text: "Grocery list" });

		const actionsEl = this.headerEl.createDiv({
			cls: "pantry-actions",
		});

		this.makeIconButton(actionsEl, "refresh-cw", "Refresh from recipes", async () => {
			await this.deps.manager.refresh();
			new Notice("Grocery list refreshed.");
		});

		this.makeIconButton(actionsEl, "settings-2", "Grouping", (evt) => {
			this.openGroupingMenu(evt);
		});

		this.makeIconButton(
			actionsEl,
			"calendar-days",
			"Import meal plan into shopping list",
			() => {
				new MealPlanPickerModal(
					this.app,
					this.deps.manager,
				).open();
			},
		);

		this.makeIconButton(actionsEl, "share", "Export grocery list", () => {
			new ExportListModal(this.app, {
				getSettings: this.deps.getSettings,
				manager: this.deps.manager,
			}).open();
		});

		const addBtn = new ButtonComponent(actionsEl)
			.setButtonText("Add item")
			.onClick(() => {
				new AddOneOffModal(this.app, this.deps.manager).open();
			});
		addBtn.buttonEl.addClass("pantry-add");

		const clearBtn = new ButtonComponent(actionsEl)
			.setButtonText("Clear list")
			.onClick(() => {
				new ConfirmModal(this.app, {
					title: "Clear list?",
					message:
						"This will deselect every recipe currently on the list, remove all one-off items, and reset all checks. This can't be undone.",
					confirmText: "Clear list",
					destructive: true,
					onConfirm: async () => {
						await this.deps.manager.clearAll();
					},
				}).open();
			});
		clearBtn.buttonEl.addClasses(["mod-warning", "pantry-clear"]);
	}

	private openGroupingMenu(evt: MouseEvent | undefined): void {
		const menu = new Menu();
		const settings = this.deps.getSettings();
		const options: Array<[PantrySettings["grouping"], string]> = [
			["category", "By category"],
			["recipe", "By recipe"],
			["none", "Flat list"],
		];
		for (const [value, label] of options) {
			menu.addItem((item) =>
				item
					.setTitle(label)
					.setChecked(settings.grouping === value)
					.onClick(async () => {
						settings.grouping = value;
						await this.deps.saveSettings();
						this.renderList();
					}),
			);
		}
		if (evt) {
			menu.showAtMouseEvent(evt);
		} else {
			const target = this.headerEl.getBoundingClientRect();
			menu.showAtPosition({ x: target.right, y: target.bottom });
		}
	}

	private makeIconButton(
		parent: HTMLElement,
		icon: string,
		tooltip: string,
		onClick: (evt: MouseEvent) => void | Promise<void>,
	): void {
		const btn = parent.createEl("button", { cls: "clickable-icon" });
		btn.setAttribute("aria-label", tooltip);
		btn.setAttribute("type", "button");
		setIcon(btn, icon);
		btn.addEventListener("click", (evt) => {
			void onClick(evt);
		});
	}

	private renderList(): void {
		this.listEl.empty();
		const items = this.deps.manager.getItems();
		const oneOffs = this.deps.manager.getOneOffs();
		const individual = this.deps.manager.getIndividualRecipes();
		const planned = this.deps.manager.getPlannedRecipes();

		this.renderSummary(items, oneOffs);
		this.renderRecipeSections(individual, planned);

		if (items.length === 0) {
			const empty = this.listEl.createDiv({ cls: "pantry-empty" });
			empty.createEl("p", {
				text: "Nothing on the list yet.",
			});
			empty.createEl("p", {
				cls: "pantry-hint",
				text: "Mark a recipe with the selection property, add recipes from the meal planner, or add a one-off item.",
			});
			return;
		}

		const settings = this.deps.getSettings();
		const grouped = groupForDisplay(items, settings);
		for (const [groupName, groupItems] of grouped) {
			if (groupItems.length === 0) continue;
			this.renderGroup(groupName, groupItems, oneOffs);
		}
	}

	private renderGroup(
		groupName: string,
		groupItems: GroceryItem[],
		oneOffs: OneOffItem[],
	): void {
		const collapsed = this.deps.manager.isGroupCollapsed(groupName);
		const checkedCount = groupItems.filter((i) => i.checked).length;
		const totalCount = groupItems.length;
		const allChecked = totalCount > 0 && checkedCount === totalCount;

		const section = this.listEl.createDiv({ cls: "pantry-group" });
		if (collapsed) section.addClass("is-collapsed");
		if (allChecked) section.addClass("is-complete");

		const header = section.createEl("button", {
			cls: "pantry-group-header",
		});
		header.setAttribute("type", "button");
		header.setAttribute("aria-expanded", collapsed ? "false" : "true");
		header.setAttribute(
			"aria-label",
			`${collapsed ? "Expand" : "Collapse"} ${groupName}`,
		);

		const chevron = header.createSpan({ cls: "pantry-chevron" });
		setIcon(chevron, "chevron-down");

		header.createSpan({
			cls: "pantry-group-title",
			text: groupName,
		});

		header.createSpan({
			cls: "pantry-group-count",
			text: `${checkedCount}/${totalCount}`,
		});

		header.addEventListener("click", () => {
			void this.deps.manager.setGroupCollapsed(groupName, !collapsed);
		});

		const ul = section.createEl("ul", { cls: "pantry-items" });
		for (const item of groupItems) {
			this.renderItem(ul, item, oneOffs);
		}
	}

	private renderSummary(items: GroceryItem[], oneOffs: OneOffItem[]): void {
		this.summaryEl.empty();
		if (items.length === 0) return;
		const checked = items.filter((i) => i.checked).length;
		const total = items.length;
		this.summaryEl.createSpan({
			text: `${checked}/${total} checked · ${oneOffs.length} one-off${
				oneOffs.length === 1 ? "" : "s"
			}`,
		});
	}

	private renderRecipeSections(
		individual: TFile[],
		planned: Array<{ file: TFile; count: number }>,
	): void {
		this.recipesEl.empty();
		if (individual.length === 0 && planned.length === 0) return;

		if (planned.length > 0) {
			this.renderRecipeGroup(
				"Meal plan",
				planned.map((entry) => ({
					file: entry.file,
					planCount: entry.count,
				})),
			);
		}
		if (individual.length > 0) {
			this.renderRecipeGroup(
				"Selected",
				individual.map((file) => ({ file })),
			);
		}
	}

	private renderRecipeGroup(
		title: string,
		entries: Array<{ file: TFile; planCount?: number }>,
	): void {
		const settings = this.deps.getSettings();
		const section = this.recipesEl.createDiv({
			cls: "pantry-recipes-section",
		});

		section.createDiv({
			cls: "pantry-recipes-header",
			text: `${title} (${entries.length})`,
		});

		const ul = section.createEl("ul", {
			cls: "pantry-recipes-list",
		});
		for (const { file, planCount } of entries) {
			const li = ul.createEl("li", { cls: "pantry-recipe" });
			const link = li.createEl("a", {
				cls: "pantry-recipe-link",
				text: file.basename,
				href: "#",
			});
			link.setAttribute("aria-label", `Open ${file.basename}`);
			link.addEventListener("click", (evt) => {
				evt.preventDefault();
				const newLeaf = evt.metaKey || evt.ctrlKey;
				void this.app.workspace
					.getLeaf(newLeaf ? "tab" : false)
					.openFile(file);
			});

			const cache = this.app.metadataCache.getFileCache(file);
			const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
			const recipeAllergens = readAllergens(fm);
			const matches = matchingAllergens(
				recipeAllergens,
				settings.myAllergens,
			);
			if (matches.length > 0) {
				const warn = li.createSpan({
					cls: "pantry-recipe-allergen-icon",
				});
				setIcon(warn, "alert-triangle");
				warn.setAttribute(
					"title",
					`Contains ${matches.join(", ")}`,
				);
				warn.setAttribute(
					"aria-label",
					`Allergen warning: contains ${matches.join(", ")}`,
				);
			}

			if (planCount !== undefined && planCount > 1) {
				li.createSpan({
					cls: "pantry-recipe-plan-count",
					text: `×${planCount}`,
					attr: { title: `${planCount} slots in the meal plan` },
				});
			}

			const multiplier = readRecipeMultiplier(cache);
			if (multiplier !== 1) {
				li.createSpan({
					cls: "pantry-recipe-multiplier",
					text: `${formatMultiplier(multiplier)}×`,
				});
			}
		}
	}

	/** Find matching inventory item for a grocery item by normalised name. */
	private findMatchingInventory(item: GroceryItem): InventoryItem | null {
		const inventoryItems = this.deps.inventoryManager.getItems();
		return (
			inventoryItems.find((inv) =>
				normaliseEqual(inv.name, item.name),
			) || null
		);
	}

	private renderItem(
		parent: HTMLElement,
		item: GroceryItem,
		oneOffs: OneOffItem[],
	): void {
		const li = parent.createEl("li", { cls: "pantry-item" });
		if (item.checked) li.addClass("is-checked");

		const checkbox = li.createEl("input", {
			cls: "pantry-checkbox",
			type: "checkbox",
		});
		checkbox.checked = item.checked;
		checkbox.addEventListener("change", () => {
			void this.deps.manager.toggleChecked(item.key, checkbox.checked);
		});

		const body = li.createDiv({ cls: "pantry-item-body" });

		const main = body.createDiv({ cls: "pantry-item-main" });

		// Inventory status indicator (if inventory item exists)
		const inventoryItem = this.findMatchingInventory(item);
		if (inventoryItem) {
			const status = getItemStatus(inventoryItem);
			const statusIcon = main.createSpan({
				cls: "pantry-item-status",
			});
			statusIcon.addClass(getStatusClass(status));
			setIcon(statusIcon, getStatusIcon(status));
			statusIcon.setAttribute("title", getStatusLabel(status));
		}

		main.createSpan({
			cls: "pantry-name",
			text: toTitleCase(item.name),
		});

		// Show needed quantity
		const qtyAndUnit = [formatQuantity(item.quantity), item.unit]
			.filter(Boolean)
			.join(" ");
		if (qtyAndUnit) {
			main.createSpan({
				cls: "pantry-qty",
				text: ` (${qtyAndUnit})`,
			});
		}

		const meta = body.createDiv({ cls: "pantry-meta" });
		const sourceLabels = item.sources.map((s) => s.label).join(" | ");
		if (sourceLabels) {
			meta.createSpan({
				cls: "pantry-source",
				text: sourceLabels,
			});
		}

		// Action buttons
		const actions = li.createDiv({ cls: "pantry-item-actions" });

		// Shop link buttons (if the matching inventory item has any configured)
		if (inventoryItem && inventoryItem.shopLinks.length > 0) {
			renderShopLinkButtons(actions, inventoryItem.shopLinks);
		}

		const matchingOneOff = oneOffs.find(
			(o) => normaliseEqual(o.name, item.name) && (o.unit || "") === (item.unit || ""),
		);
		if (matchingOneOff) {
			const removeBtn = li.createEl("button", {
				cls: "pantry-remove clickable-icon",
			});
			removeBtn.setAttribute("aria-label", "Remove one-off item");
			removeBtn.setAttribute("type", "button");
			setIcon(removeBtn, "x");
			removeBtn.addEventListener("click", () => {
				void this.deps.manager.removeOneOff(matchingOneOff.id);
			});

			this.attachContextMenu(li, matchingOneOff);
		}
	}

	/**
	 * Wire a row to open the one-off context menu on right-click (desktop)
	 * or long-press (mobile). The long-press timer is cancelled on touch
	 * move/end so quick taps still toggle the checkbox normally.
	 */
	private attachContextMenu(row: HTMLElement, oneOff: OneOffItem): void {
		row.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			this.openOneOffMenu(oneOff, { x: evt.clientX, y: evt.clientY });
		});

		const LONG_PRESS_MS = 500;
		const MOVE_TOLERANCE_PX = 8;
		let timer: number | null = null;
		let startX = 0;
		let startY = 0;

		const cancel = () => {
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
			}
		};

		row.addEventListener("touchstart", (evt) => {
			const touch = evt.touches.length === 1 ? evt.touches[0] : null;
			if (!touch) return;
			startX = touch.clientX;
			startY = touch.clientY;
			cancel();
			timer = window.setTimeout(() => {
				timer = null;
				this.openOneOffMenu(oneOff, { x: startX, y: startY });
			}, LONG_PRESS_MS);
		}, { passive: true });

		row.addEventListener("touchmove", (evt) => {
			if (timer === null) return;
			const touch = evt.touches.length === 1 ? evt.touches[0] : null;
			if (!touch) return;
			if (
				Math.abs(touch.clientX - startX) > MOVE_TOLERANCE_PX ||
				Math.abs(touch.clientY - startY) > MOVE_TOLERANCE_PX
			) {
				cancel();
			}
		}, { passive: true });

		row.addEventListener("touchend", cancel);
		row.addEventListener("touchcancel", cancel);
	}

	private openOneOffMenu(
		oneOff: OneOffItem,
		position: { x: number; y: number },
	): void {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle("Edit item…")
				.setIcon("pencil")
				.onClick(() => {
					new AddOneOffModal(
						this.app,
						this.deps.manager,
						oneOff,
					).open();
				}),
		);

		menu.addItem((item) =>
			item
				.setTitle("Move to category…")
				.setIcon("folder")
				.onClick(() => {
					this.openCategoryMenu(oneOff, position);
				}),
		);

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle("Remove")
				.setIcon("trash")
				.setWarning(true)
				.onClick(async () => {
					await this.deps.manager.removeOneOff(oneOff.id);
				}),
		);

		menu.showAtPosition(position);
	}

	private openCategoryMenu(
		oneOff: OneOffItem,
		position: { x: number; y: number },
	): void {
		const categories = this.deps.manager.getKnownCategories();
		const current = oneOff.category?.trim() || null;
		const menu = new Menu();

		for (const cat of categories) {
			menu.addItem((item) =>
				item
					.setTitle(cat)
					.setChecked(current === cat)
					.onClick(async () => {
						await this.deps.manager.updateOneOff(oneOff.id, {
							category: cat,
						});
					}),
			);
		}

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle("Auto-detect")
				.setChecked(current === null)
				.onClick(async () => {
					await this.deps.manager.updateOneOff(oneOff.id, {
						category: null,
					});
				}),
		);

		menu.addItem((item) =>
			item
				.setTitle("New category…")
				.setIcon("plus")
				.onClick(() => {
					new AddOneOffModal(
						this.app,
						this.deps.manager,
						oneOff,
					).open();
				}),
		);

		menu.showAtPosition(position);
	}
}

function normaliseEqual(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function formatMultiplier(num: number): string {
	if (Number.isInteger(num)) return String(num);
	return String(Math.round(num * 100) / 100);
}
