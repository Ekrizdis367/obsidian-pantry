import {
	App,
	ButtonComponent,
	EventRef,
	ItemView,
	Menu,
	Modal,
	Notice,
	Setting,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import { InventoryManager } from "../grocery/inventory-manager";
import { PantrySettings } from "../settings";
import { toTitleCase } from "../utils/text";
import { ItemStatus, getItemStatus } from "../utils/inventory-status";
import { AddItemModal } from "./add-inventory-item-modal";
import { ConfirmModal } from "./confirm-modal";
import {
	RowContext,
	renderItemRow,
	renderSectionCard,
	restoreFocus,
	runWrite,
	wireItemDropTarget,
	wireQuickAddRow,
} from "./inventory-item-row";

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
	/** Which top-level surface is showing: the aggregated overview, or the per-page editor. */
	private mode: "overview" | "manage" = "overview";
	/** Page currently open in "Manage pages" mode. */
	private managedPagePath: string | null = null;
	/** Shared context (hover card, focus tracking) for row/section-card rendering helpers. */
	private rowCtx!: RowContext;
	private zoomLabelEl!: HTMLElement;

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

		const hoverCardEl = document.body.createDiv({ cls: "pantry-hover-card" });
		hoverCardEl.addClass("is-hidden");
		this.rowCtx = {
			app: this.app,
			manager: this.deps.manager,
			hoverCardEl,
			hover: { timer: null },
			focus: { key: null },
			getScopeEl: () => this.listEl,
		};

		this.managedPagePath = this.deps.manager.getLastManagedPage() || null;

		this.renderHeader();

		this.changedRef = this.deps.manager.on("changed", () => {
			this.render();
		});

		await this.deps.manager.refresh();
		this.render();
	}

	onClose(): Promise<void> {
		if (this.changedRef) {
			this.deps.manager.offref(this.changedRef);
		}
		if (this.rowCtx.hover.timer !== null) window.clearTimeout(this.rowCtx.hover.timer);
		this.rowCtx.hoverCardEl.remove();
		return Promise.resolve();
	}

	private render(): void {
		if (this.mode === "overview") this.renderOverview();
		else this.renderManage();
	}

	private setMode(mode: "overview" | "manage"): void {
		this.mode = mode;
		this.renderHeader();
		this.render();
	}

	// ------------------------------------------------------------------
	// Header
	// ------------------------------------------------------------------

	private renderHeader(): void {
		this.headerEl.empty();

		const titleWrap = this.headerEl.createDiv({
			cls: "pantry-header-content",
		});
		titleWrap.createEl("h2", {
			text: "Inventory",
			cls: "pantry-title",
		});

		const rightGroup = this.headerEl.createDiv({ cls: "pantry-header-right" });

		const modeToggle = rightGroup.createDiv({ cls: "pantry-mode-toggle" });
		const overviewBtn = modeToggle.createEl("button", {
			cls: `pantry-mode-btn${this.mode === "overview" ? " is-active" : ""}`,
			text: "Overview",
		});
		overviewBtn.addEventListener("click", () => this.setMode("overview"));
		const manageBtn = modeToggle.createEl("button", {
			cls: `pantry-mode-btn${this.mode === "manage" ? " is-active" : ""}`,
			text: "Manage",
		});
		manageBtn.addEventListener("click", () => this.setMode("manage"));

		const actions = rightGroup.createDiv({ cls: "pantry-actions" });

		if (this.mode === "overview") {
			const addBtn = new ButtonComponent(actions)
				.setIcon("plus")
				.setTooltip("Add item")
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
		} else {
			const newPageBtn = new ButtonComponent(actions)
				.setButtonText("New page")
				.onClick(() => this.openNewPageModal());
			newPageBtn.buttonEl.addClass("pantry-add");
		}
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
		const options: Array<["flat" | "section" | "tag", string]> = [
			["flat", "Alphabetical"],
			["section", "By page/section"],
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

	// ------------------------------------------------------------------
	// Overview mode — aggregated, filterable master list
	// ------------------------------------------------------------------

	private renderOverview(): void {
		this.listEl.empty();
		this.summaryEl.empty();

		const rowScale = this.deps.getSettings().inventoryState.rowScale;
		this.listEl.style.setProperty("zoom", String(rowScale));
		if (this.zoomLabelEl) this.zoomLabelEl.setText(`${Math.round(rowScale * 100)}%`);

		this.renderSectionFilters(this.summaryEl);
		this.renderTagFilters(this.summaryEl);

		const allEntries = this.deps.manager.getEntries();
		const entries = this.deps.manager.getFilteredEntries();
		this.summaryEl.createEl("p", {
			text: `${entries.length} item${entries.length !== 1 ? "s" : ""} in inventory`,
		});

		if (allEntries.length === 0) {
			this.listEl.createDiv({
				cls: "pantry-empty",
				text: "No inventory items yet. Add one, or switch to Manage to set up your first inventory page and sections.",
			});
			return;
		}
		if (entries.length === 0) {
			this.listEl.createDiv({
				cls: "pantry-empty",
				text: "No items match the selected filters.",
			});
			return;
		}

		this.renderColumnHeader();

		const groupBy = this.deps.getSettings().inventoryState.groupBy;
		const showLocation = groupBy !== "section";
		const grouped = this.deps.manager.getGroupedEntries();

		for (const [groupName, groupEntries] of grouped) {
			if (groupEntries.length === 0) continue;

			if (groupBy === "flat") {
				const ul = this.listEl.createEl("ul", { cls: "pantry-items" });
				for (const entry of groupEntries) {
					renderItemRow(this.rowCtx, ul, entry, { showLocation });
				}
				continue;
			}

			const group = this.listEl.createDiv({
				cls: `pantry-group${
					this.deps.manager.isGroupCollapsed(groupName) ? " is-collapsed" : ""
				}`,
			});
			if (groupBy === "section") {
				const first = groupEntries[0];
				if (first) wireItemDropTarget(this.rowCtx, group, first.filePath, first.sectionName);
			}

			const header = group.createEl("button", { cls: "pantry-group-header" });
			header.addEventListener("click", () => this.toggleGroupCollapsed(groupName));

			const chevron = header.createSpan({ cls: "pantry-chevron" });
			setIcon(chevron, "chevron-down");

			header.createEl("h3", { text: groupName, cls: "pantry-group-title" });
			header.createSpan({ cls: "pantry-group-count", text: String(groupEntries.length) });

			const itemsList = group.createEl("ul", { cls: "pantry-items" });
			for (const entry of groupEntries) {
				renderItemRow(this.rowCtx, itemsList, entry, { showLocation });
			}
		}

		restoreFocus(this.rowCtx);
	}

	/**
	 * Shared rendering for a filter chip row: a small "All" chip (active
	 * when nothing is selected) plus one chip per option. Clicking a chip
	 * toggles it on/off; picking any specific chip turns "All" off and
	 * narrows the list to what's selected (OR-match).
	 */
	private renderChipFilter(
		container: HTMLElement,
		label: string,
		options: Array<{ key: string; text: string; title?: string }>,
		selected: string[],
		onToggle: (key: string) => void,
		onReset: () => void,
		extraClass?: string,
	): void {
		if (options.length === 0) return;

		const wrap = container.createDiv({
			cls: `pantry-tag-filters${extraClass ? ` ${extraClass}` : ""}`,
		});
		wrap.createSpan({ cls: "pantry-filter-label", text: label });

		const allChip = wrap.createEl("button", {
			cls: `pantry-tag-chip${selected.length === 0 ? " is-active" : ""}`,
			text: "All",
		});
		allChip.addEventListener("click", () => onReset());

		for (const opt of options) {
			const isSelected = selected.includes(opt.key);
			const chip = wrap.createEl("button", {
				cls: `pantry-tag-chip${isSelected ? " is-active" : ""}`,
				text: opt.text,
				attr: opt.title ? { title: opt.title } : undefined,
			});
			chip.addEventListener("click", () => onToggle(opt.key));
		}
	}

	private renderTagFilters(container: HTMLElement): void {
		const tags = this.deps.manager.getKnownTags();
		this.renderChipFilter(
			container,
			"Tags",
			tags.map((t) => ({ key: t, text: t })),
			this.deps.getSettings().inventoryState.filterTags,
			(key) => void this.deps.manager.toggleFilterTag(key),
			() => void this.deps.manager.setFilterTags([]),
		);
	}

	/** Section chips: a temporary scope filter ("just show me a subset of my inventory right now"). */
	private renderSectionFilters(container: HTMLElement): void {
		const sections = this.deps.manager.getKnownSections();
		if (sections.length <= 1) return;
		this.renderChipFilter(
			container,
			"Sections",
			sections.map((s) => ({
				key: s.key,
				text: s.sectionName,
				title: `${s.pageName} › ${s.sectionName}`,
			})),
			this.deps.getSettings().inventoryState.sectionFilter,
			(key) => void this.deps.manager.toggleSectionFilter(key),
			() => void this.deps.manager.setSectionFilter([]),
			"pantry-section-filters",
		);
	}

	/** Column titles matching each row's grid layout, for a spreadsheet-like look. */
	private renderColumnHeader(): void {
		const row = this.listEl.createDiv({ cls: "pantry-item-grid pantry-column-header" });
		row.createSpan({ cls: "pantry-col-status" });
		row.createSpan({ cls: "pantry-col-qty", text: "Qty" });
		row.createSpan({ cls: "pantry-col-name", text: "Name" });
		row.createSpan({ cls: "pantry-col-shops", text: "Shops" });
		row.createSpan({ cls: "pantry-col-actions" });
	}

	private toggleGroupCollapsed(groupName: string): void {
		const isCollapsed = this.deps.manager.isGroupCollapsed(groupName);
		void this.deps.manager.setGroupCollapsed(groupName, !isCollapsed);
	}

	// ------------------------------------------------------------------
	// Manage mode — per-page section editor
	// ------------------------------------------------------------------

	private renderManage(): void {
		this.listEl.empty();
		this.summaryEl.empty();

		const pages = this.deps.manager.getPages();
		if (pages.length === 0) {
			this.listEl.createDiv({
				cls: "pantry-empty",
				text: "No inventory pages yet. Create one to start organizing items into sections.",
			});
			const createBtn = this.listEl.createEl("button", {
				cls: "mod-cta",
				text: "Create your first inventory page",
			});
			createBtn.addEventListener("click", () => this.openNewPageModal());
			return;
		}

		if (!this.managedPagePath || !pages.some((p) => p.file.path === this.managedPagePath)) {
			this.managedPagePath = pages[0]?.file.path ?? null;
		}
		const current = pages.find((p) => p.file.path === this.managedPagePath);
		if (!current) return;

		this.renderPageSelector(this.summaryEl, pages, current.file.path, current.file.basename);

		for (const section of current.page.sections) {
			renderSectionCard(this.rowCtx, this.listEl, current.file.path, current.file.basename, section);
		}

		const addSectionRow = this.listEl.createDiv({ cls: "pantry-quick-add pantry-add-section-row" });
		wireQuickAddRow(this.rowCtx, addSectionRow, "New section name…", (name) => {
			runWrite(this.deps.manager.addSection(current.file.path, name, []));
		});
	}

	private renderPageSelector(
		container: HTMLElement,
		pages: ReturnType<InventoryManager["getPages"]>,
		currentPath: string,
		currentName: string,
	): void {
		const row = container.createDiv({ cls: "pantry-page-selector" });

		const pageBtn = new ButtonComponent(row)
			.setButtonText(currentName)
			.setIcon("chevron-down");
		pageBtn.buttonEl.addClass("pantry-page-picker-btn");
		pageBtn.onClick((evt) => {
			const menu = new Menu();
			for (const p of pages) {
				menu.addItem((item) =>
					item
						.setTitle(p.file.basename)
						.setChecked(p.file.path === currentPath)
						.onClick(() => {
							this.managedPagePath = p.file.path;
							void this.deps.manager.setLastManagedPage(p.file.path);
							this.render();
						}),
				);
			}
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle("New inventory page…")
					.setIcon("plus")
					.onClick(() => this.openNewPageModal()),
			);
			menu.showAtMouseEvent(evt);
		});

		new ButtonComponent(row)
			.setIcon("file-text")
			.setTooltip("Open note")
			.onClick(() => {
				void this.app.workspace.getLeaf(false).openFile(pages.find((p) => p.file.path === currentPath)!.file);
			});

		new ButtonComponent(row)
			.setIcon("trash-2")
			.setTooltip("Delete this page")
			.onClick(() => this.confirmDeletePage(currentPath, currentName));
	}

	private confirmDeletePage(filePath: string, basename: string): void {
		new ConfirmModal(this.app, {
			title: "Delete inventory page",
			message: `Move "${basename}" to trash? It's removed from the inventory tab; the note itself goes to system trash and can be recovered.`,
			confirmText: "Delete page",
			destructive: true,
			onConfirm: async () => {
				await this.deps.manager.deletePage(filePath);
				if (this.managedPagePath === filePath) this.managedPagePath = null;
				new Notice(`Deleted "${basename}"`);
			},
		}).open();
	}

	private openNewPageModal(): void {
		const pages = this.deps.manager.getPages();
		const defaultFolder =
			pages[0]?.file.parent?.path ?? this.deps.getSettings().inventoryFolders[0] ?? "";
		new NewInventoryPageModal(this.app, defaultFolder, async (name, folder, sectionName) => {
			const file = await this.deps.manager.createPage(name, folder, sectionName);
			this.managedPagePath = file.path;
			void this.deps.manager.setLastManagedPage(file.path);
			this.mode = "manage";
			this.renderHeader();
			this.render();
			new Notice(`Created inventory page "${file.basename}"`);
		}).open();
	}

	private openAddItemModal(filePath?: string, sectionName?: string): void {
		const pages = this.deps.manager.getPages();
		const defaultFile = filePath ?? this.managedPagePath ?? pages[0]?.file.path ?? "";
		const page = pages.find((p) => p.file.path === defaultFile)?.page;
		const defaultSection = sectionName ?? page?.sections[0]?.name ?? "Items";
		new AddItemModal(this.app, this.deps.manager, {
			filePath: defaultFile,
			sectionName: defaultSection,
		}).open();
	}

	/** Copy a restock list (out-of-stock and low items) to the clipboard. */
	private async exportRestockList(): Promise<void> {
		const restockItems = this.deps.manager.getItems().filter((item) => {
			const status = getItemStatus(item);
			return status === ItemStatus.OUT_OF_STOCK || status === ItemStatus.LOW;
		});

		if (restockItems.length === 0) {
			new Notice("Nothing needs restocking.");
			return;
		}

		const lines: string[] = ["Restock list:"];
		for (const item of restockItems) {
			const missing = Math.max(0, (item.desiredQuantity || 0) - (item.quantity || 0));
			const unitSuffix = item.unit ? ` ${item.unit}` : "";
			lines.push(
				`- ${toTitleCase(item.name)}: need ${missing}${unitSuffix} (have ${item.quantity || 0}, want ${item.desiredQuantity || 0})`,
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
				`Copied restock list (${restockItems.length} item${restockItems.length === 1 ? "" : "s"}) to clipboard.`,
			);
		} catch (e) {
			new Notice(`Could not copy to clipboard: ${String(e)}`);
		}
	}
}

/** Small modal collecting a name/folder/first-section-name for a brand-new inventory page. */
class NewInventoryPageModal extends Modal {
	private name = "";
	private folder: string;
	private sectionName = "Items";

	constructor(
		app: App,
		defaultFolder: string,
		private readonly onCreate: (
			name: string,
			folder: string,
			sectionName: string,
		) => Promise<void>,
	) {
		super(app);
		this.folder = defaultFolder;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "New inventory page" });

		new Setting(contentEl).setName("Name").addText((t) =>
			t.setPlaceholder("Dry goods").onChange((v) => {
				this.name = v;
			}),
		);
		new Setting(contentEl)
			.setName("Folder")
			.setDesc("Vault-relative folder for the new page.")
			.addText((t) =>
				t.setValue(this.folder).onChange((v) => {
					this.folder = v;
				}),
			);
		new Setting(contentEl).setName("First section name").addText((t) =>
			t.setValue(this.sectionName).onChange((v) => {
				this.sectionName = v;
			}),
		);

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((btn) =>
				btn
					.setButtonText("Create")
					.setCta()
					.onClick(() => void this.submit()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		const name = this.name.trim();
		if (!name) {
			new Notice("Please enter a page name.");
			return;
		}
		try {
			await this.onCreate(name, this.folder, this.sectionName.trim() || "Items");
			this.close();
		} catch (e) {
			new Notice(`Error creating page: ${String(e)}`);
		}
	}
}

