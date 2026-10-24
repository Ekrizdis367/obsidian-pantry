import {
	Menu,
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
	debounce,
} from "obsidian";
import { registerCommands } from "./commands";
import { GroceryListManager, SaveSink } from "./grocery/manager";
import {
	DEFAULT_SHOPPING_STATE_PATH,
	emptyShoppingState,
	mergeShoppingState,
	parseShoppingState,
	readShoppingStateFile,
	resolveShoppingStatePath,
	serializeShoppingState,
	shoppingStateHasContent,
	writeShoppingStateFile,
} from "./grocery/shopping-state";
import { InventoryManager, InventorySaveSink } from "./grocery/inventory-manager";
import { importLegacyInventory } from "./grocery/inventory-migration";
import {
	DEFAULT_INVENTORY_STATE_PATH,
	emptyInventoryState,
	inventoryStateHasContent,
	mergeInventoryState,
	parseInventoryState,
	LegacyInventory,
	readInventoryStateFile,
	readLegacyInventory,
	resolveInventoryStatePath,
	serializeInventoryState,
	writeInventoryStateFile,
} from "./grocery/inventory-state";
import { inventoryTypeMatches } from "./grocery/inventory-library";
import { recipeTypeMatches } from "./parser/recipe";
import {
	applyEffectiveAisle,
	categoriesFromNames,
	emptyAisleLayout,
	ensureShop,
	normalizeAisleLocal,
	parseAisleLayout,
	parseCategoryLines,
	readAisleLayoutFile,
	resolveAisleLayoutPath,
	serializeAisleLayout,
	writeAisleLayoutFile,
} from "./grocery/aisle-layout";
import {
	DEFAULT_AISLE_LAYOUT_PATH,
	DEFAULT_AISLE_SHOP,
	DEFAULT_CATEGORY_ORDER,
	DEFAULT_MEAL_PLAN_SLOT_SELECTION,
	DEFAULT_SETTINGS,
	normalizeMealPlanSlots,
	PantrySettings,
} from "./settings";
import { CategoryOverride } from "./types";
import { PantrySettingsTab } from "./ui/settings-tab";
import { MealPlannerView, VIEW_TYPE_MEAL_PLANNER } from "./ui/planner-view";
import { RecipeView, VIEW_TYPE_RECIPE } from "./ui/recipe-view";
import { GroceryListView, VIEW_TYPE_GROCERY_LIST } from "./ui/view";
import { InventoryView, VIEW_TYPE_INVENTORY } from "./ui/inventory-view";
import { InventoryPageView, VIEW_TYPE_INVENTORY_PAGE, isInventoryPageFile } from "./ui/inventory-page-view";

/** Re-assert cadence for the recipe/inventory-page view swaps, and how many times to try. */
const AUTO_OPEN_RETRY_MS = 30;
const AUTO_OPEN_MAX_ATTEMPTS = 6;

export default class PantryPlugin extends Plugin {
	settings!: PantrySettings;
	manager!: GroceryListManager;
	inventoryManager!: InventoryManager;
	/** Vault path awaiting a metadata-cache retry for recipe auto-open. */
	private autoOpenRecipePendingPath: string | null = null;
	/** Pending deferred recipe-view swap, so it can be cancelled/superseded. */
	private autoOpenRecipeTimer: number | null = null;
	/** Vault path awaiting a metadata-cache retry for inventory-page auto-open. */
	private autoOpenInventoryPendingPath: string | null = null;
	/** Pending deferred inventory-page-view swap, so it can be cancelled/superseded. */
	private autoOpenInventoryTimer: number | null = null;
	/**
	 * Last file path observed per leaf for auto-open. Used to skip `file-open`
	 * events that are just tab/focus returns to a leaf that already has the
	 * note open (#13) — fresh opens and in-leaf navigations still auto-open.
	 * Closed leaves are dropped on layout-change.
	 */
	private leafOpenPaths = new Map<WorkspaceLeaf, string>();
	/**
	 * Last content we wrote to the shopping-state file. Used to ignore our own
	 * vault modify events so a self-write does not trigger a redundant reload.
	 */
	private shoppingStateWriteToken: string | null = null;
	/**
	 * Last content we wrote to the inventory-state file. Used to ignore our own
	 * vault modify events so a self-write does not trigger a redundant reload.
	 */
	private inventoryStateWriteToken: string | null = null;
	/**
	 * Last content we wrote to the aisle-layout file. Used to ignore our own
	 * vault modify events so a self-write does not trigger a redundant reload.
	 */
	private aisleLayoutWriteToken: string | null = null;
	/** Leftover pre-file-based items awaiting import; state-file writes are held until it's cleared. */
	private pendingLegacyInventory: LegacyInventory | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.loadShoppingState();
		// Before anything can rewrite the state file (which would drop `items`).
		this.pendingLegacyInventory = await readLegacyInventory(
			this.app,
			this.settings.inventoryStatePath,
		);
		await this.loadInventoryState();
		await this.loadAisleLayout();

		const sink: SaveSink = makeSaveSink(this);
		this.manager = new GroceryListManager(this.app, sink);

		const inventorySink: InventorySaveSink = makeInventorySaveSink(this);
		this.inventoryManager = new InventoryManager(this.app, inventorySink);

		// Register every view type synchronously, before any awaited work below,
		// so Obsidian always has a view creator ready if it restores a leaf of
		// one of these types while reopening the previous workspace layout.
		this.registerView(
			VIEW_TYPE_GROCERY_LIST,
			(leaf) =>
				new GroceryListView(leaf, {
					manager: this.manager,
					inventoryManager: this.inventoryManager,
					getSettings: () => this.settings,
					saveSettings: () => this.saveSettings(),
				}),
		);

		this.registerView(
			VIEW_TYPE_MEAL_PLANNER,
			(leaf) =>
				new MealPlannerView(leaf, {
					manager: this.manager,
					getSettings: () => this.settings,
					saveSettings: () => this.saveSettings(),
				}),
		);

		this.registerView(
			VIEW_TYPE_RECIPE,
			(leaf) =>
				new RecipeView(leaf, {
					getSettings: () => this.settings,
					openInMarkdown: (target) => this.openLeafInMarkdown(target),
					onSelectionChanged: () => {
						void this.manager.refresh();
					},
				}),
		);

		this.registerView(
			VIEW_TYPE_INVENTORY,
			(leaf) =>
				new InventoryView(leaf, {
					manager: this.inventoryManager,
					getSettings: () => this.settings,
					saveSettings: () => this.saveSettings(),
				}),
		);

		this.registerView(
			VIEW_TYPE_INVENTORY_PAGE,
			(leaf) =>
				new InventoryPageView(leaf, {
					manager: this.inventoryManager,
					openInMarkdown: (leaf) => this.openLeafInMarkdown(leaf),
				}),
		);

		// Obsidian prepends each new ribbon icon above the previous ones, so
		// the LAST call here ends up topmost. Add in reverse of the desired
		// visual stacking (inventory at the bottom, grocery list at the top).
		this.addRibbonIcon("archive", "Open inventory", () => {
			void this.activateInventoryView();
		});

		this.addRibbonIcon("calendar-days", "Open meal planner", () => {
			void this.activatePlannerView();
		});

		this.addRibbonIcon("shopping-cart", "Open grocery list", () => {
			void this.activateView();
		});

		registerCommands({
			plugin: this,
			manager: this.manager,
			settings: this.settings,
			saveSettings: () => this.saveSettings(),
			openView: () => this.activateView(),
			openMealPlanner: () => this.activatePlannerView(),
			openInventory: () => this.activateInventoryView(),
			openCurrentAsRecipe: () => this.openCurrentAsRecipe(),
			openCurrentAsMarkdown: () => this.openCurrentAsMarkdown(),
		});

		this.registerEvent(
			this.inventoryManager.on("changed", () => {
				this.manager.reapplyInventoryFilter();
			}),
		);

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!file) {
					this.autoOpenRecipePendingPath = null;
					this.autoOpenInventoryPendingPath = null;
					return;
				}
				// Obsidian also fires file-open when switching back to an
				// already-open tab. Skip auto-open in that case so Markdown
				// (or any non-recipe mode) sticks until the note is closed.
				if (this.noteAlreadyOpenInActiveLeaf(file)) {
					return;
				}
				this.autoOpenRecipePendingPath = file.path;
				this.maybeAutoOpenRecipe(file);
				this.autoOpenInventoryPendingPath = file.path;
				this.maybeAutoOpenInventory(file);
			}),
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.pruneClosedLeafOpenPaths();
			}),
		);

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (!this.autoOpenRecipePendingPath) return;
				if (file.path !== this.autoOpenRecipePendingPath) return;
				const active = this.app.workspace.getActiveFile();
				if (!active || active.path !== file.path) return;
				this.maybeAutoOpenRecipe(file);
			}),
		);

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (!this.autoOpenInventoryPendingPath) return;
				if (file.path !== this.autoOpenInventoryPendingPath) return;
				const active = this.app.workspace.getActiveFile();
				if (!active || active.path !== file.path) return;
				this.maybeAutoOpenInventory(file);
			}),
		);

		this.registerEvent(
			this.app.workspace.on(
				"file-menu",
				(menu, file, source, leaf) => {
					this.maybeAddRecipeModeMenuItem(menu, file, source, leaf);
					this.maybeAddInventoryModeMenuItem(menu, file, source, leaf);
				},
			),
		);

		this.addSettingTab(
			new PantrySettingsTab(this, {
				settings: this.settings,
				saveSettings: () => this.saveSettings(),
				manager: this.manager,
				inventoryManager: this.inventoryManager,
				reloadShoppingState: () => this.loadShoppingState(),
				reloadInventoryState: () => this.loadInventoryState(),
				setActiveShop: (name) => this.setActiveShop(name),
				setSharedCategoriesFromLines: (text) =>
					this.setSharedCategoriesFromLines(text),
				setSharedOverrides: (overrides) => this.setSharedOverrides(overrides),
				setLocalCategoriesFromLines: (text) =>
					this.setLocalCategoriesFromLines(text),
				setLocalOverrides: (overrides) => this.setLocalOverrides(overrides),
				resetSharedCategories: () => this.resetSharedCategories(),
				reloadAisleLayout: () => this.loadAisleLayout(),
			}),
		);

		await this.inventoryManager.refresh();

		const refresh = debounce(
			() => {
				void this.manager.refresh();
			},
			500,
			true,
		);
		const refreshInventory = debounce(
			() => {
				void this.inventoryManager.refresh();
			},
			500,
			true,
		);

		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				refresh();
				refreshInventory();
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (this.isShoppingStateFile(file)) {
					this.settings.state = emptyShoppingState();
					void this.manager.refresh();
					return;
				}
				if (this.isInventoryStateFile(file)) {
					this.settings.inventoryState = emptyInventoryState();
					void this.inventoryManager.refresh();
					return;
				}
				if (this.isAisleLayoutFile(file)) {
					void this.loadAisleLayout();
					return;
				}
				this.forgetLeafOpenPath(file.path);
				refresh();
				refreshInventory();
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (this.isShoppingStatePath(oldPath)) {
					if (file instanceof TFile) {
						this.settings.shoppingStatePath = file.path;
						void this.saveSettings();
					}
					return;
				}
				if (this.isInventoryStatePath(oldPath)) {
					if (file instanceof TFile) {
						this.settings.inventoryStatePath = file.path;
						void this.saveSettings();
					}
					return;
				}
				if (this.isAisleLayoutPath(oldPath)) {
					if (file instanceof TFile) {
						this.settings.aisleLayoutPath = file.path;
						void this.saveSettings();
					}
					return;
				}
				if (file instanceof TFile) {
					this.renameLeafOpenPath(oldPath, file.path);
				} else {
					this.forgetLeafOpenPath(oldPath);
				}
				refresh();
				refreshInventory();
			}),
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!(file instanceof TFile)) return;
				if (this.isShoppingStateFile(file)) {
					void this.onShoppingStateFileModified(file);
					return;
				}
				if (this.isInventoryStateFile(file)) {
					void this.onInventoryStateFileModified(file);
					return;
				}
				if (this.isAisleLayoutFile(file)) {
					void this.onAisleLayoutFileModified(file);
					return;
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (!(file instanceof TFile)) return;
				if (this.isShoppingStateFile(file)) {
					void this.onShoppingStateFileModified(file);
					return;
				}
				if (this.isInventoryStateFile(file)) {
					void this.onInventoryStateFileModified(file);
					return;
				}
				if (this.isAisleLayoutFile(file)) {
					void this.onAisleLayoutFileModified(file);
					return;
				}
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			void this.manager.refresh();
			if (this.pendingLegacyInventory) void this.migrateLegacyInventory();
			else void this.inventoryManager.refresh();
		});
	}

	onunload(): void {
		// Save inventory state before unloading
		void this.persistAllInventory();
		// Leaves are detached automatically by Obsidian on unload.
		this.clearAutoOpenRecipeTimer();
		this.clearAutoOpenInventoryTimer();
	}

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PantrySettings> | null;
		this.settings = mergeSettings(raw);
	}

	/**
	 * Persist plugin settings to data.json. Shopping-list runtime state is
	 * stripped so it is not stored device-locally; that state lives in the
	 * vault via {@link saveShoppingState}.
	 */
	async saveSettings(): Promise<void> {
		await this.saveData(settingsForDisk(this.settings));
	}

	/**
	 * Load one-offs / checks / collapsed sections from the vault JSON file.
	 * Migrates legacy state out of data.json on first run after the upgrade,
	 * merging per-device leftovers so nothing is dropped when Sync catches up.
	 */
	async loadShoppingState(): Promise<void> {
		const path = resolveShoppingStatePath(this.settings.shoppingStatePath);
		this.settings.shoppingStatePath = path;
		const legacy = this.settings.state;
		const hadLegacy = shoppingStateHasContent(legacy);
		const fromVault = await readShoppingStateFile(this.app, path);
		if (fromVault) {
			this.settings.state = hadLegacy
				? mergeShoppingState(fromVault, legacy)
				: fromVault;
			if (
				hadLegacy &&
				serializeShoppingState(this.settings.state) !==
					serializeShoppingState(fromVault)
			) {
				await this.saveShoppingState();
			}
			// Drop any legacy copy still sitting in data.json.
			await this.saveSettings();
			return;
		}

		// No vault file yet — keep whatever mergeSettings loaded (legacy
		// data.json state, or empty) and migrate it into the vault when
		// there is something to preserve.
		if (hadLegacy) {
			await this.saveShoppingState();
			await this.saveSettings();
		}
	}

	/** Write the in-memory shopping list state to its vault JSON file. */
	async saveShoppingState(): Promise<void> {
		const path = resolveShoppingStatePath(this.settings.shoppingStatePath);
		this.settings.shoppingStatePath = path;
		const content = serializeShoppingState(this.settings.state);
		this.shoppingStateWriteToken = content;
		await writeShoppingStateFile(this.app, path, this.settings.state);
	}

	/** Persist settings and shopping state together (used by the manager sink). */
	async persistAll(): Promise<void> {
		await this.saveShoppingState();
		await this.saveSettings();
	}

	private async onShoppingStateFileModified(file: TFile): Promise<void> {
		const raw = await this.app.vault.cachedRead(file);
		if (raw === this.shoppingStateWriteToken) return;
		const parsed = parseShoppingState(raw);
		if (!parsed) return;
		this.settings.state = parsed;
		await this.manager.refresh();
	}

	private isShoppingStateFile(file: TAbstractFile): boolean {
		return this.isShoppingStatePath(file.path);
	}

	private isShoppingStatePath(path: string): boolean {
		return (
			path === resolveShoppingStatePath(this.settings.shoppingStatePath)
		);
	}

	/**
	 * Load inventory items from the vault JSON file.
	 * Similar to loadShoppingState, handles migration and merging.
	 */
	async loadInventoryState(): Promise<void> {
		const path = resolveInventoryStatePath(
			this.settings.inventoryStatePath,
		);
		this.settings.inventoryStatePath = path;
		const legacy = this.settings.inventoryState;
		const hadLegacy = inventoryStateHasContent(legacy);
		const fromVault = await readInventoryStateFile(this.app, path);
		if (fromVault) {
			this.settings.inventoryState = hadLegacy
				? mergeInventoryState(fromVault, legacy)
				: fromVault;
			// Drop any legacy copy still sitting in data.json.
			await this.saveSettings();
			return;
		}

		// No vault file yet — keep whatever mergeSettings loaded (legacy
		// data.json state, or empty) and migrate it into the vault when
		// there is something to preserve.
		if (hadLegacy) {
			await this.saveInventoryState();
			await this.saveSettings();
		}
	}

	/** Write the in-memory inventory state to its vault JSON file. */
	async saveInventoryState(): Promise<void> {
		if (this.pendingLegacyInventory) return;
		const path = resolveInventoryStatePath(
			this.settings.inventoryStatePath,
		);
		this.settings.inventoryStatePath = path;
		const content = serializeInventoryState(this.settings.inventoryState);
		this.inventoryStateWriteToken = content;
		await writeInventoryStateFile(
			this.app,
			path,
			this.settings.inventoryState,
		);
	}

	/** Persist settings and inventory state together (used by the manager sink). */
	async persistAllInventory(): Promise<void> {
		await this.saveInventoryState();
		await this.saveSettings();
	}

	private async onInventoryStateFileModified(file: TFile): Promise<void> {
		const raw = await this.app.vault.cachedRead(file);
		if (raw === this.inventoryStateWriteToken) return;
		const parsed = parseInventoryState(raw);
		if (!parsed) {
			console.error(
				`pantry: failed to parse inventory state at ${file.path}`,
			);
			return;
		}
		this.settings.inventoryState = parsed;
		await this.inventoryManager.refresh();
	}

	private isInventoryStateFile(file: TAbstractFile): boolean {
		return this.isInventoryStatePath(file.path);
	}

	private isInventoryStatePath(path: string): boolean {
		return (
			path === resolveInventoryStatePath(this.settings.inventoryStatePath)
		);
	}

	/** Import leftover pre-file-based items, then rewrite the state file without them. */
	private async migrateLegacyInventory(): Promise<void> {
		const legacy = this.pendingLegacyInventory;
		if (!legacy) return;
		try {
			const result = await importLegacyInventory(this.app, this.inventoryManager, legacy, {
				statePath: resolveInventoryStatePath(this.settings.inventoryStatePath),
				folder: this.settings.inventoryFolders[0]?.trim() || "Pantry",
			});
			this.pendingLegacyInventory = null;
			await this.saveInventoryState();
			if (result.pagePath) {
				new Notice(
					`Pantry: imported ${result.importedCount} inventory item(s) into "${result.pagePath}". The old list was backed up to "${result.backupPath}".`,
				);
			}
		} catch (e) {
			// Leave pendingLegacyInventory set so state writes stay held and the next launch retries.
			console.error("pantry: legacy inventory migration failed", e);
			new Notice(
				"Pantry: couldn't import your old inventory list. It's been left untouched in the inventory state file.",
			);
		}
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_GROCERY_LIST);
		if (existing.length > 0) {
			// Reuse an existing grocery list view - bringing back a buried
			// tab is friendlier than spawning a duplicate every invocation.
			leaf = existing[0] ?? null;
		} else {
			// Open in a main-area tab so the list reads horizontally and
			// behaves like any other note.
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({
				type: VIEW_TYPE_GROCERY_LIST,
				active: true,
			});
		}
		if (leaf) {
			await workspace.revealLeaf(leaf);
		}
	}

	async activatePlannerView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_MEAL_PLANNER);
		if (existing.length > 0) {
			leaf = existing[0] ?? null;
		} else {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({
				type: VIEW_TYPE_MEAL_PLANNER,
				active: true,
			});
		}
		if (leaf) {
			await workspace.revealLeaf(leaf);
		}
	}

	async activateInventoryView(): Promise<void> {
		const { workspace } = this.app;
		const [leaf, ...duplicates] = workspace.getLeavesOfType(VIEW_TYPE_INVENTORY);
		// Self-heal any duplicate tabs that may have accumulated (e.g. across
		// reloads during development) so "open inventory" reliably reuses one tab.
		for (const dup of duplicates) dup.detach();
		if (leaf) {
			await workspace.revealLeaf(leaf);
			workspace.setActiveLeaf(leaf, { focus: true });
			return;
		}
		const newLeaf = workspace.getLeaf("tab");
		await newLeaf.setViewState({
			type: VIEW_TYPE_INVENTORY,
			active: true,
		});
		await workspace.revealLeaf(newLeaf);
	}

	/**
	 * Switch the active leaf to the recipe view, if it currently holds a
	 * markdown file. No-op when the active item isn't a markdown file.
	 */
	async openCurrentAsRecipe(): Promise<void> {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return;
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || file.extension !== "md") return;
		this.leafOpenPaths.set(leaf, file.path);
		await leaf.setViewState({
			type: VIEW_TYPE_RECIPE,
			state: { file: file.path },
			active: true,
		});
	}

	/** Switch the active leaf back to the standard markdown view. */
	async openCurrentAsMarkdown(): Promise<void> {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return;
		await this.openLeafInMarkdown(leaf);
	}

	async openLeafInMarkdown(leaf: WorkspaceLeaf): Promise<void> {
		// Cancel any in-flight auto-open retries so they don't fight the
		// user's explicit switch back to Markdown.
		this.clearAutoOpenRecipeTimer();
		this.autoOpenRecipePendingPath = null;
		this.clearAutoOpenInventoryTimer();
		this.autoOpenInventoryPendingPath = null;
		const view = leaf.view;
		const file =
			view instanceof RecipeView
				? view.file
				: this.app.workspace.getActiveFile();
		if (!(file instanceof TFile)) return;
		// Record the path so a later tab-focus file-open is treated as a
		// refocus, not a fresh open.
		this.leafOpenPaths.set(leaf, file.path);
		await leaf.setViewState({
			type: "markdown",
			state: { file: file.path, mode: "source" },
			active: true,
		});
	}

	/**
	 * Adds a "Recipe mode" entry to the pane's 3-dot menu when the active
	 * file is a markdown note that isn't already in the recipe view. The
	 * item sits in the same "pane" section as the built-in source/reading
	 * mode toggles.
	 */
	private maybeAddRecipeModeMenuItem(
		menu: Menu,
		file: TAbstractFile,
		source: string,
		leaf?: WorkspaceLeaf,
	): void {
		if (source !== "more-options") return;
		if (!leaf) return;
		if (!(file instanceof TFile)) return;
		if (file.extension !== "md") return;
		if (leaf.view.getViewType() === VIEW_TYPE_RECIPE) return;

		menu.addItem((item) => {
			item.setTitle("Recipe mode")
				.setIcon("chef-hat")
				.setSection("pane")
				.onClick(() => {
					this.leafOpenPaths.set(leaf, file.path);
					void leaf.setViewState({
						type: VIEW_TYPE_RECIPE,
						state: { file: file.path },
						active: true,
					});
				});
		});
	}

	/**
	 * Adds an "Inventory mode" entry to the pane's 3-dot menu when the active
	 * file is a recognised inventory page (folder + frontmatter type match)
	 * that isn't already showing in that view.
	 */
	private maybeAddInventoryModeMenuItem(
		menu: Menu,
		file: TAbstractFile,
		source: string,
		leaf?: WorkspaceLeaf,
	): void {
		if (source !== "more-options") return;
		if (!leaf) return;
		if (!(file instanceof TFile)) return;
		if (file.extension !== "md") return;
		if (leaf.view.getViewType() === VIEW_TYPE_INVENTORY_PAGE) return;
		if (!isInventoryPageFile(this.inventoryManager, file)) return;

		menu.addItem((item) => {
			item.setTitle("Inventory mode")
				.setIcon("archive")
				.setSection("pane")
				.onClick(() => {
					this.leafOpenPaths.set(leaf, file.path);
					void leaf.setViewState({
						type: VIEW_TYPE_INVENTORY_PAGE,
						state: { file: file.path },
						active: true,
					});
				});
		});
	}

	/**
	 * True when the active leaf already had this file open. Used to ignore
	 * focus/tab-return `file-open` events so auto-open only runs on fresh
	 * opens and in-leaf navigations.
	 */
	private noteAlreadyOpenInActiveLeaf(file: TFile): boolean {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return false;
		const previous = this.leafOpenPaths.get(leaf);
		this.leafOpenPaths.set(leaf, file.path);
		return previous === file.path;
	}

	/** Drop tracking for leaves that no longer exist (note closed). */
	private pruneClosedLeafOpenPaths(): void {
		const openLeaves = new Set<WorkspaceLeaf>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			openLeaves.add(leaf);
		});
		for (const leaf of this.leafOpenPaths.keys()) {
			if (!openLeaves.has(leaf)) {
				this.leafOpenPaths.delete(leaf);
			}
		}
	}

	private forgetLeafOpenPath(path: string): void {
		for (const [leaf, openPath] of this.leafOpenPaths) {
			if (openPath === path) {
				this.leafOpenPaths.delete(leaf);
			}
		}
	}

	private renameLeafOpenPath(oldPath: string, newPath: string): void {
		for (const [leaf, openPath] of this.leafOpenPaths) {
			if (openPath === oldPath) {
				this.leafOpenPaths.set(leaf, newPath);
			}
		}
	}

	private maybeAutoOpenRecipe(file: TFile): void {
		if (!this.settings.autoOpenRecipeView) return;
		if (file.extension !== "md") return;

		const cache = this.app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
		const property = this.settings.recipeTypeProperty.trim() || "type";
		if (!recipeTypeMatches(fm[property], this.settings.recipeTypeValue)) {
			if (cache?.frontmatter !== undefined) {
				this.autoOpenRecipePendingPath = null;
			}
			return;
		}

		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return;
		if (leaf.view.getViewType() === VIEW_TYPE_RECIPE) {
			this.autoOpenRecipePendingPath = null;
			return;
		}

		this.autoOpenRecipePendingPath = null;
		this.leafOpenPaths.set(leaf, file.path);
		this.scheduleRecipeViewSwap(file);
	}

	/**
	 * Swaps the active leaf to the recipe view after Obsidian's file-open
	 * state settles. Stops once it succeeds, times out, or the active file
	 * changes.
	 */
	private scheduleRecipeViewSwap(file: TFile): void {
		this.clearAutoOpenRecipeTimer();
		let attempts = 0;
		const trySwap = (): void => {
			this.autoOpenRecipeTimer = null;
			if (this.app.workspace.getActiveFile()?.path !== file.path) return;
			const leaf = this.app.workspace.getMostRecentLeaf();
			if (!leaf) return;
			// Already showing the recipe view — the swap stuck, nothing to do.
			if (leaf.view.getViewType() === VIEW_TYPE_RECIPE) return;
			void leaf.setViewState({
				type: VIEW_TYPE_RECIPE,
				state: { file: file.path },
				active: true,
			});
			if (++attempts < AUTO_OPEN_MAX_ATTEMPTS) {
				this.autoOpenRecipeTimer = window.setTimeout(
					trySwap,
					AUTO_OPEN_RETRY_MS,
				);
			}
		};
		this.autoOpenRecipeTimer = window.setTimeout(trySwap, 0);
	}

	private clearAutoOpenRecipeTimer(): void {
		if (this.autoOpenRecipeTimer === null) return;
		window.clearTimeout(this.autoOpenRecipeTimer);
		this.autoOpenRecipeTimer = null;
	}

	private maybeAutoOpenInventory(file: TFile): void {
		if (!this.settings.autoOpenInventoryView) return;
		if (file.extension !== "md") return;

		const cache = this.app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
		const property = this.settings.inventoryTypeProperty.trim() || "type";
		if (!inventoryTypeMatches(fm[property], this.settings.inventoryTypeValue)) {
			if (cache?.frontmatter !== undefined) {
				this.autoOpenInventoryPendingPath = null;
			}
			return;
		}

		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return;
		if (leaf.view.getViewType() === VIEW_TYPE_INVENTORY_PAGE) {
			this.autoOpenInventoryPendingPath = null;
			return;
		}

		this.autoOpenInventoryPendingPath = null;
		this.leafOpenPaths.set(leaf, file.path);
		this.scheduleInventoryViewSwap(file);
	}

	/**
	 * Swaps the active leaf to the inventory page view after Obsidian's
	 * file-open state settles. Stops once it succeeds, times out, or the
	 * active file changes. Mirrors {@link scheduleRecipeViewSwap}.
	 */
	private scheduleInventoryViewSwap(file: TFile): void {
		this.clearAutoOpenInventoryTimer();
		let attempts = 0;
		const trySwap = (): void => {
			this.autoOpenInventoryTimer = null;
			if (this.app.workspace.getActiveFile()?.path !== file.path) return;
			const leaf = this.app.workspace.getMostRecentLeaf();
			if (!leaf) return;
			if (leaf.view.getViewType() === VIEW_TYPE_INVENTORY_PAGE) return;
			void leaf.setViewState({
				type: VIEW_TYPE_INVENTORY_PAGE,
				state: { file: file.path },
				active: true,
			});
			if (++attempts < AUTO_OPEN_MAX_ATTEMPTS) {
				this.autoOpenInventoryTimer = window.setTimeout(
					trySwap,
					AUTO_OPEN_RETRY_MS,
				);
			}
		};
		this.autoOpenInventoryTimer = window.setTimeout(trySwap, 0);
	}

	private clearAutoOpenInventoryTimer(): void {
		if (this.autoOpenInventoryTimer === null) return;
		window.clearTimeout(this.autoOpenInventoryTimer);
		this.autoOpenInventoryTimer = null;
	}

	/**
	 * Load the shared aisle layout from the vault. The first launch copies
	 * the category order out of plugin settings into that file. Later loads
	 * trust the file and layer this device's local additions on top.
	 */
	async loadAisleLayout(): Promise<void> {
		const path = resolveAisleLayoutPath(this.settings.aisleLayoutPath);
		this.settings.aisleLayoutPath = path;
		const shopName = this.settings.activeShop.trim() || DEFAULT_AISLE_SHOP;
		this.settings.activeShop = shopName;
		const read = await readAisleLayoutFile(this.app, path);
		if (read.missing) {
			const hadShops = Object.keys(this.settings.aisleLayout.shops).length > 0;
			if (!hadShops) {
				this.settings.aisleLayout = {
					shops: {
						[shopName]: {
							categories: categoriesFromNames(this.settings.categoryOrder),
							overrides: this.settings.categoryOverrides.map((override) => ({
								...override,
							})),
						},
					},
				};
				new Notice(
					`Pantry: aisle order is now saved in "${path}" so it syncs with this vault.`,
				);
			}
			await this.saveAisleLayout();
		} else if (read.layout) {
			this.settings.aisleLayout = read.layout;
		} else {
			new Notice(
				"Pantry: couldn't read the aisle layout file. The grocery list is using the order already loaded.",
			);
			if (!this.settings.aisleLayout.shops[shopName]) {
				this.settings.aisleLayout = {
					shops: {
						[shopName]: {
							categories: categoriesFromNames(this.settings.categoryOrder),
							overrides: this.settings.categoryOverrides.map((override) => ({
								...override,
							})),
						},
					},
				};
			}
		}
		applyEffectiveAisle(this.settings);
		await this.saveSettings();
		await this.manager?.refresh();
	}

	/** Write the shared layout. Device-local additions stay in data.json. */
	async saveAisleLayout(): Promise<void> {
		const path = resolveAisleLayoutPath(this.settings.aisleLayoutPath);
		this.settings.aisleLayoutPath = path;
		const content = serializeAisleLayout(this.settings.aisleLayout);
		this.aisleLayoutWriteToken = content;
		await writeAisleLayoutFile(this.app, path, this.settings.aisleLayout);
	}

	/** Switch the device's shop. A new name starts as a copy of the previous shop. */
	async setActiveShop(name: string): Promise<void> {
		const shop = name.trim() || DEFAULT_AISLE_SHOP;
		if (shop === this.settings.activeShop && this.settings.aisleLayout.shops[shop]) {
			return;
		}
		const previous = this.settings.aisleLayout.shops[this.settings.activeShop];
		this.settings.activeShop = shop;
		const created = !this.settings.aisleLayout.shops[shop];
		ensureShop(this.settings.aisleLayout, shop, previous);
		applyEffectiveAisle(this.settings);
		if (created) await this.saveAisleLayout();
		await this.saveSettings();
		await this.manager.refresh();
	}

	/** Replace the active shop's shared aisles from the settings textarea. */
	async setSharedCategoriesFromLines(text: string): Promise<void> {
		const shop = ensureShop(
			this.settings.aisleLayout,
			this.settings.activeShop,
			this.settings.aisleLayout.shops[this.settings.activeShop],
		);
		shop.categories = parseCategoryLines(text);
		applyEffectiveAisle(this.settings);
		await this.saveAisleLayout();
		await this.saveSettings();
		this.manager.trigger("changed");
	}

	/** Replace the active shop's shared name overrides. */
	async setSharedOverrides(overrides: CategoryOverride[]): Promise<void> {
		const shop = ensureShop(
			this.settings.aisleLayout,
			this.settings.activeShop,
		);
		shop.overrides = overrides;
		applyEffectiveAisle(this.settings);
		await this.saveAisleLayout();
		await this.saveSettings();
		await this.manager.refresh();
	}

	/** Replace this device's extra aisles for the active shop. */
	async setLocalCategoriesFromLines(text: string): Promise<void> {
		const shopName = this.settings.activeShop;
		const categories = parseCategoryLines(text);
		const current = this.settings.aisleLocal.shops[shopName] ?? {
			categories: [],
			overrides: [],
		};
		if (categories.length === 0 && current.overrides.length === 0) {
			delete this.settings.aisleLocal.shops[shopName];
		} else {
			this.settings.aisleLocal.shops[shopName] = {
				categories,
				overrides: current.overrides,
			};
		}
		applyEffectiveAisle(this.settings);
		await this.saveSettings();
		this.manager.trigger("changed");
	}

	/** Replace this device's name overrides for the active shop. */
	async setLocalOverrides(overrides: CategoryOverride[]): Promise<void> {
		const shopName = this.settings.activeShop;
		const current = this.settings.aisleLocal.shops[shopName] ?? {
			categories: [],
			overrides: [],
		};
		if (overrides.length === 0 && current.categories.length === 0) {
			delete this.settings.aisleLocal.shops[shopName];
		} else {
			this.settings.aisleLocal.shops[shopName] = {
				categories: current.categories,
				overrides,
			};
		}
		applyEffectiveAisle(this.settings);
		await this.saveSettings();
		await this.manager.refresh();
	}

	/** Restore the active shop's shared aisle order to the built-in list. */
	async resetSharedCategories(): Promise<void> {
		const shop = ensureShop(
			this.settings.aisleLayout,
			this.settings.activeShop,
		);
		shop.categories = categoriesFromNames(DEFAULT_CATEGORY_ORDER);
		applyEffectiveAisle(this.settings);
		await this.saveAisleLayout();
		await this.saveSettings();
		await this.manager.refresh();
	}

	private async onAisleLayoutFileModified(file: TFile): Promise<void> {
		const raw = await this.app.vault.cachedRead(file);
		if (raw === this.aisleLayoutWriteToken) return;
		const parsed = parseAisleLayout(raw);
		if (!parsed) {
			console.error(`pantry: failed to parse aisle layout at ${file.path}`);
			return;
		}
		this.settings.aisleLayout = parsed;
		applyEffectiveAisle(this.settings);
		await this.manager.refresh();
	}

	private isAisleLayoutFile(file: TAbstractFile): boolean {
		return this.isAisleLayoutPath(file.path);
	}

	private isAisleLayoutPath(path: string): boolean {
		return path === resolveAisleLayoutPath(this.settings.aisleLayoutPath);
	}
}

function makeSaveSink(plugin: PantryPlugin): SaveSink {
	return {
		get settings() {
			return plugin.settings;
		},
		save: () => plugin.persistAll(),
		getInventoryItems: () => plugin.inventoryManager.getItems(),
	};
}

function makeInventorySaveSink(plugin: PantryPlugin): InventorySaveSink {
	return {
		get settings() {
			return plugin.settings;
		},
		save: () => plugin.persistAllInventory(),
	};
}

/** Settings blob written to data.json — shopping state stays in the vault. */
function settingsForDisk(settings: PantrySettings): PantrySettings {
	return {
		...settings,
		aisleLayout: emptyAisleLayout(),
		aisleCategories: [],
		state: emptyShoppingState(),
		inventoryState: emptyInventoryState(),
	};
}

function mergeSettings(raw: Partial<PantrySettings> | null): PantrySettings {
	const base: PantrySettings = {
		...DEFAULT_SETTINGS,
		categoryOrder: [...DEFAULT_CATEGORY_ORDER],
		categoryOverrides: [],
		recipeFolders: [],
		state: emptyShoppingState(),
		inventoryState: emptyInventoryState(),
	};
	if (!raw) return base;

	const merged: PantrySettings = {
		...base,
		...raw,
		grouping:
			raw.grouping === "category" ||
			raw.grouping === "recipe" ||
			raw.grouping === "none"
				? raw.grouping
				: base.grouping,
		checkedItemDisplay:
			raw.checkedItemDisplay === "inline" ||
			raw.checkedItemDisplay === "bottom" ||
			raw.checkedItemDisplay === "hidden"
				? raw.checkedItemDisplay
				: base.checkedItemDisplay,
		categorySource:
			raw.categorySource === "tag" ||
			raw.categorySource === "tag-then-dictionary" ||
			raw.categorySource === "dictionary"
				? raw.categorySource
				: base.categorySource,
		autoCollapseCompleted:
			typeof raw.autoCollapseCompleted === "boolean"
				? raw.autoCollapseCompleted
				: base.autoCollapseCompleted,
		autoOpenRecipeView:
			typeof raw.autoOpenRecipeView === "boolean"
				? raw.autoOpenRecipeView
				: base.autoOpenRecipeView,
		suppressInlineRecipeImage:
			typeof raw.suppressInlineRecipeImage === "boolean"
				? raw.suppressInlineRecipeImage
				: base.suppressInlineRecipeImage,
		recipeTypeProperty:
			typeof raw.recipeTypeProperty === "string" &&
			raw.recipeTypeProperty.trim()
				? raw.recipeTypeProperty.trim()
				: base.recipeTypeProperty,
		recipeTypeValue:
			typeof raw.recipeTypeValue === "string" && raw.recipeTypeValue.trim()
				? raw.recipeTypeValue.trim()
				: base.recipeTypeValue,
		autoOpenInventoryView:
			typeof raw.autoOpenInventoryView === "boolean"
				? raw.autoOpenInventoryView
				: base.autoOpenInventoryView,
		state: {
			oneOffs: Array.isArray(raw.state?.oneOffs)
				? (raw.state?.oneOffs ?? [])
				: [],
			checkedKeys:
				raw.state?.checkedKeys && typeof raw.state.checkedKeys === "object"
					? { ...raw.state.checkedKeys }
					: {},
			collapsedGroups:
				raw.state?.collapsedGroups &&
				typeof raw.state.collapsedGroups === "object"
					? { ...raw.state.collapsedGroups }
					: {},
		},
		categoryOrder: Array.isArray(raw.categoryOrder)
			? raw.categoryOrder
			: base.categoryOrder,
		categoryOverrides: Array.isArray(raw.categoryOverrides)
			? raw.categoryOverrides
			: base.categoryOverrides,
		aisleLayoutPath:
			typeof raw.aisleLayoutPath === "string" && raw.aisleLayoutPath.trim()
				? raw.aisleLayoutPath.trim()
				: DEFAULT_AISLE_LAYOUT_PATH,
		activeShop:
			typeof raw.activeShop === "string" && raw.activeShop.trim()
				? raw.activeShop.trim()
				: DEFAULT_AISLE_SHOP,
		aisleLayout: emptyAisleLayout(),
		aisleLocal: normalizeAisleLocal(raw.aisleLocal),
		aisleCategories: [],
		recipeFolders: Array.isArray(raw.recipeFolders)
			? raw.recipeFolders
			: base.recipeFolders,
		inventoryFolders: Array.isArray(raw.inventoryFolders)
			? raw.inventoryFolders
			: base.inventoryFolders,
		inventoryTypeProperty:
			typeof raw.inventoryTypeProperty === "string" &&
			raw.inventoryTypeProperty.trim()
				? raw.inventoryTypeProperty.trim()
				: base.inventoryTypeProperty,
		inventoryTypeValue:
			typeof raw.inventoryTypeValue === "string" && raw.inventoryTypeValue.trim()
				? raw.inventoryTypeValue.trim()
				: base.inventoryTypeValue,
		myAllergens: Array.isArray(raw.myAllergens)
			? raw.myAllergens
					.filter((s): s is string => typeof s === "string")
					.map((s) => s.trim().toLowerCase())
					.filter(Boolean)
			: base.myAllergens,
		trackCookedCount:
			typeof raw.trackCookedCount === "boolean"
				? raw.trackCookedCount
				: base.trackCookedCount,
		suggestionDayWindow:
			typeof raw.suggestionDayWindow === "number" &&
			Number.isFinite(raw.suggestionDayWindow) &&
			raw.suggestionDayWindow >= 0
				? Math.round(raw.suggestionDayWindow)
				: base.suggestionDayWindow,
		suggestionCount:
			typeof raw.suggestionCount === "number" &&
			Number.isFinite(raw.suggestionCount) &&
			raw.suggestionCount >= 1
				? Math.round(raw.suggestionCount)
				: base.suggestionCount,
		diabeticMode:
			typeof raw.diabeticMode === "boolean"
				? raw.diabeticMode
				: base.diabeticMode,
		giDictionary:
			typeof raw.giDictionary === "string"
				? raw.giDictionary
				: base.giDictionary,
		mealPlanEnabled:
			typeof raw.mealPlanEnabled === "boolean"
				? raw.mealPlanEnabled
				: base.mealPlanEnabled,
		mealPlanNotePath:
			typeof raw.mealPlanNotePath === "string"
				? raw.mealPlanNotePath.trim()
				: base.mealPlanNotePath,
		mealPlanSlots: (() => {
			if (Array.isArray(raw.mealPlanSlots) && raw.mealPlanSlots.length > 0) {
				return normalizeMealPlanSlots(
					raw.mealPlanSlots.filter(
						(s): s is string => typeof s === "string",
					),
				);
			}
			// Legacy: single "include snacks" toggle before per-slot selection.
			const legacySnacks = (
				raw as { mealPlanIncludeSnacks?: boolean }
			).mealPlanIncludeSnacks;
			const legacy: string[] = [...DEFAULT_MEAL_PLAN_SLOT_SELECTION];
			if (legacySnacks === true) {
				legacy.push("Snacks");
			}
			return normalizeMealPlanSlots(legacy);
		})(),
		mealPlanIncludeWeekend:
			typeof raw.mealPlanIncludeWeekend === "boolean"
				? raw.mealPlanIncludeWeekend
				: base.mealPlanIncludeWeekend,
		autoFillStatusProperty:
			typeof raw.autoFillStatusProperty === "string" &&
			raw.autoFillStatusProperty.trim()
				? raw.autoFillStatusProperty.trim()
				: base.autoFillStatusProperty,
		autoFillStatusValues: (() => {
			if (!Array.isArray(raw.autoFillStatusValues)) {
				return base.autoFillStatusValues;
			}
			const vals = raw.autoFillStatusValues
				.filter(
					(n): n is number =>
						typeof n === "number" && Number.isFinite(n),
				)
				.map((n) => Math.round(n));
			return vals.length > 0 ? vals : base.autoFillStatusValues;
		})(),
		autoFillMealProperty:
			typeof raw.autoFillMealProperty === "string" &&
			raw.autoFillMealProperty.trim()
				? raw.autoFillMealProperty.trim()
				: base.autoFillMealProperty,
		autoFillMealAliases: (() => {
			const rawAliases = (
				raw as { autoFillMealAliases?: unknown }
			).autoFillMealAliases;
			if (!rawAliases || typeof rawAliases !== "object") {
				return { ...base.autoFillMealAliases };
			}
			const out: Record<string, string> = {};
			for (const [key, value] of Object.entries(
				rawAliases as Record<string, unknown>,
			)) {
				if (typeof value === "string" && value.trim()) {
					out[key] = value.trim();
				}
			}
			return out;
		})(),
		importFolder:
			typeof raw.importFolder === "string"
				? raw.importFolder.trim()
				: base.importFolder,
		downloadImportedImages:
			typeof raw.downloadImportedImages === "boolean"
				? raw.downloadImportedImages
				: base.downloadImportedImages,
		downloadImportedImagePath:
			typeof raw.downloadImportedImagePath === "string"
				? raw.downloadImportedImagePath.trim()
				: base.downloadImportedImagePath,
		importTemplatePath:
			typeof raw.importTemplatePath === "string"
				? raw.importTemplatePath.trim()
				: base.importTemplatePath,
		shoppingStatePath:
			typeof raw.shoppingStatePath === "string" &&
			raw.shoppingStatePath.trim()
				? raw.shoppingStatePath.trim()
				: DEFAULT_SHOPPING_STATE_PATH,
		inventoryStatePath:
			typeof raw.inventoryStatePath === "string" &&
			raw.inventoryStatePath.trim()
				? raw.inventoryStatePath.trim()
				: DEFAULT_INVENTORY_STATE_PATH,
		excludeInStockFromGrocery:
			typeof raw.excludeInStockFromGrocery === "boolean"
				? raw.excludeInStockFromGrocery
				: base.excludeInStockFromGrocery,
		inventoryState: {
			collapsedGroups:
				raw.inventoryState?.collapsedGroups &&
				typeof raw.inventoryState.collapsedGroups === "object"
					? { ...raw.inventoryState.collapsedGroups }
					: {},
			groupBy:
				raw.inventoryState?.groupBy === "section" ||
				raw.inventoryState?.groupBy === "tag"
					? raw.inventoryState.groupBy
					: "flat",
			rowScale:
				typeof raw.inventoryState?.rowScale === "number" &&
				Number.isFinite(raw.inventoryState.rowScale)
					? Math.min(1.4, Math.max(0.8, raw.inventoryState.rowScale))
					: 1,
			filterTags: Array.isArray(raw.inventoryState?.filterTags)
				? raw.inventoryState.filterTags.filter(
						(t): t is string => typeof t === "string",
					)
				: [],
			sectionFilter: Array.isArray(raw.inventoryState?.sectionFilter)
				? raw.inventoryState.sectionFilter.filter(
						(t): t is string => typeof t === "string",
					)
				: [],
			lastManagedPage:
				typeof raw.inventoryState?.lastManagedPage === "string"
					? raw.inventoryState.lastManagedPage
					: "",
		},
	};
	return merged;
}
