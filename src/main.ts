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
import {
	DEFAULT_CATEGORY_ORDER,
	DEFAULT_SETTINGS,
	PantrySettings,
	RECIPE_FRONTMATTER,
} from "./settings";
import { PantrySettingsTab } from "./ui/settings-tab";
import { RecipeView, VIEW_TYPE_RECIPE } from "./ui/recipe-view";
import { GroceryListView, VIEW_TYPE_GROCERY_LIST } from "./ui/view";

export default class PantryPlugin extends Plugin {
	settings!: PantrySettings;
	manager!: GroceryListManager;

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

		registerCommands({
			plugin: this,
			manager: this.manager,
			settings: this.settings,
			saveSettings: () => this.saveSettings(),
			openView: () => this.activateView(),
			openCurrentAsRecipe: () => this.openCurrentAsRecipe(),
			openCurrentAsMarkdown: () => this.openCurrentAsMarkdown(),
		});

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!file) return;
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
		const typeValue = fm[RECIPE_FRONTMATTER.type];
		const target = normalizeRecipeTypeToken(this.settings.recipeTypeValue);
		if (!target) return;
		if (!frontmatterTypeMatches(typeValue, target)) return;

		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return;
		if (leaf.view.getViewType() === VIEW_TYPE_RECIPE) return;

		void leaf.setViewState({
			type: VIEW_TYPE_RECIPE,
			state: { file: file.path },
			active: true,
		});
	}
}


/**
 * Normalizes a recipe type token by trimming whitespace, converting to lowercase,
 * and handling special Obsidian link syntax ([[...]]). This ensures consistent
 * comparison of recipe types.
 */
function normalizeRecipeTypeToken(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";

	if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
		const inner = trimmed.slice(2, -2).trim();
		const pipeIndex = inner.indexOf("|");
		const hashIndex = inner.indexOf("#");
		let cutoff = inner.length;
		if (pipeIndex >= 0) cutoff = Math.min(cutoff, pipeIndex);
		if (hashIndex >= 0) cutoff = Math.min(cutoff, hashIndex);
		return inner.slice(0, cutoff).trim().toLowerCase();
	}

	return trimmed.toLowerCase();
}

function frontmatterTypeMatches(value: unknown, target: string): boolean {
	if (typeof value === "string") {
		return normalizeRecipeTypeToken(value) === target;
	}

	if (Array.isArray(value)) {
		return value.some((item) => {
			if (typeof item !== "string") return false;
			return normalizeRecipeTypeToken(item) === target;
		});
	}

	return false;
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
		recipeTypeValue:
			typeof raw.recipeTypeValue === "string" && raw.recipeTypeValue.trim()
				? raw.recipeTypeValue.trim()
				: base.recipeTypeValue,
		nutritionDisplay:
			raw.nutritionDisplay === "per-serving" ||
			raw.nutritionDisplay === "total"
				? raw.nutritionDisplay
				: base.nutritionDisplay,
		nutritionSource:
			raw.nutritionSource === "recipe-total" ||
			raw.nutritionSource === "per-serving"
				? raw.nutritionSource
				: base.nutritionSource,
		showMarkCookedButton:
			typeof raw.showMarkCookedButton === "boolean"
				? raw.showMarkCookedButton
				: base.showMarkCookedButton,
		markCookedAskDate:
			typeof raw.markCookedAskDate === "boolean"
				? raw.markCookedAskDate
				: base.markCookedAskDate,
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
	};
	return merged;
}
