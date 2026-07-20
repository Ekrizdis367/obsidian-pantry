import {
	Menu,
	Plugin,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
	debounce,
} from "obsidian";
import { registerCommands } from "./commands";
import { GroceryListManager, SaveSink } from "./grocery/manager";
import { recipeTypeMatches } from "./parser/recipe";
import {
	DEFAULT_CATEGORY_ORDER,
	DEFAULT_MEAL_PLAN_SLOT_SELECTION,
	DEFAULT_SETTINGS,
	normalizeMealPlanSlots,
	PantrySettings,
} from "./settings";
import { PantrySettingsTab } from "./ui/settings-tab";
import { MealPlannerView, VIEW_TYPE_MEAL_PLANNER } from "./ui/planner-view";
import { RecipeView, VIEW_TYPE_RECIPE } from "./ui/recipe-view";
import { GroceryListView, VIEW_TYPE_GROCERY_LIST } from "./ui/view";

/** Re-assert cadence for the recipe-view swap, and how many times to try. */
const AUTO_OPEN_RETRY_MS = 30;
const AUTO_OPEN_MAX_ATTEMPTS = 6;

export default class PantryPlugin extends Plugin {
	settings!: PantrySettings;
	manager!: GroceryListManager;
	/** Vault path awaiting a metadata-cache retry for recipe auto-open. */
	private autoOpenRecipePendingPath: string | null = null;
	/** Pending deferred recipe-view swap, so it can be cancelled/superseded. */
	private autoOpenRecipeTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		const sink: SaveSink = makeSaveSink(this);
		this.manager = new GroceryListManager(this.app, sink);

		this.registerView(
			VIEW_TYPE_GROCERY_LIST,
			(leaf) =>
				new GroceryListView(leaf, {
					manager: this.manager,
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

		this.addRibbonIcon("shopping-cart", "Open grocery list", () => {
			void this.activateView();
		});

		this.addRibbonIcon("calendar-days", "Open meal planner", () => {
			void this.activatePlannerView();
		});

		registerCommands({
			plugin: this,
			manager: this.manager,
			settings: this.settings,
			saveSettings: () => this.saveSettings(),
			openView: () => this.activateView(),
			openMealPlanner: () => this.activatePlannerView(),
			openCurrentAsRecipe: () => this.openCurrentAsRecipe(),
			openCurrentAsMarkdown: () => this.openCurrentAsMarkdown(),
		});

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!file) {
					this.autoOpenRecipePendingPath = null;
					return;
				}
				this.autoOpenRecipePendingPath = file.path;
				this.maybeAutoOpenRecipe(file);
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
			this.app.workspace.on(
				"file-menu",
				(menu, file, source, leaf) => {
					this.maybeAddRecipeModeMenuItem(menu, file, source, leaf);
				},
			),
		);

		this.addSettingTab(new PantrySettingsTab(this, {
			app: this.app,
			settings: this.settings,
			saveSettings: () => this.saveSettings(),
			manager: this.manager,
		}));

		const refresh = debounce(
			() => {
				void this.manager.refresh();
			},
			500,
			true,
		);

		this.registerEvent(
			this.app.metadataCache.on("changed", () => refresh()),
		);
		this.registerEvent(
			this.app.vault.on("delete", () => refresh()),
		);
		this.registerEvent(
			this.app.vault.on("rename", () => refresh()),
		);

		this.app.workspace.onLayoutReady(() => {
			void this.manager.refresh();
		});
	}

	onunload(): void {
		// Leaves are detached automatically by Obsidian on unload.
		this.clearAutoOpenRecipeTimer();
	}

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as
			| Partial<PantrySettings>
			| null;
		this.settings = mergeSettings(raw);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
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

	/**
	 * Switch the active leaf to the recipe view, if it currently holds a
	 * markdown file. No-op when the active item isn't a markdown file.
	 */
	async openCurrentAsRecipe(): Promise<void> {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return;
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || file.extension !== "md") return;
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
		const view = leaf.view;
		const file =
			view instanceof RecipeView
				? view.file
				: this.app.workspace.getActiveFile();
		if (!(file instanceof TFile)) return;
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
					void leaf.setViewState({
						type: VIEW_TYPE_RECIPE,
						state: { file: file.path },
						active: true,
					});
				});
		});
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
}

function makeSaveSink(plugin: PantryPlugin): SaveSink {
	return {
		get settings() {
			return plugin.settings;
		},
		save: () => plugin.saveSettings(),
	};
}

function mergeSettings(
	raw: Partial<PantrySettings> | null,
): PantrySettings {
	const base: PantrySettings = {
		...DEFAULT_SETTINGS,
		categoryOrder: [...DEFAULT_CATEGORY_ORDER],
		categoryOverrides: [],
		recipeFolders: [],
		state: {
			oneOffs: [],
			checkedKeys: {},
			collapsedGroups: {},
		},
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
		recipeFolders: Array.isArray(raw.recipeFolders)
			? raw.recipeFolders
			: base.recipeFolders,
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
				.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
				.map((n) => Math.round(n));
			return vals.length > 0 ? vals : base.autoFillStatusValues;
		})(),
		autoFillMealProperty:
			typeof raw.autoFillMealProperty === "string" &&
			raw.autoFillMealProperty.trim()
				? raw.autoFillMealProperty.trim()
				: base.autoFillMealProperty,
		importFolder:
			typeof raw.importFolder === "string"
				? raw.importFolder.trim()
				: base.importFolder,
		importTemplatePath:
			typeof raw.importTemplatePath === "string"
				? raw.importTemplatePath.trim()
				: base.importTemplatePath,
	};
	return merged;
}
