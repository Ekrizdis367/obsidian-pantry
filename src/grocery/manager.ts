import { App, Events, Notice, TFile } from "obsidian";
import {
	ingredientKey,
	normaliseName,
	parseIngredientLine,
} from "../parser/ingredient";
import {
	findSelectedRecipes,
	parseRecipeFile,
} from "../parser/recipe";
import {
	parseMealPlanContents,
	PlanOccurrence,
} from "../parser/meal-plan";
import { PantrySettings } from "../settings";
import {
	GroceryItem,
	InventoryItem,
	OneOffItem,
	RecipeIngredient,
} from "../types";
import { buildGroceryList, groupForDisplay } from "./aggregator";
import {
	buildInStockNameSet,
	excludeInStockFromGrocery,
} from "../utils/inventory-stock";

export interface SaveSink {
	readonly settings: PantrySettings;
	save(): Promise<void>;
	/** Current inventory items, used to exclude in-stock staples from grocery. */
	getInventoryItems(): InventoryItem[];
}

/** A recipe contributing to the list via the live meal-plan source. */
export interface PlannedRecipeEntry {
	file: TFile;
	/** How many slots in the plan reference this recipe. */
	count: number;
}

/**
 * Owns the in-memory grocery list and broadcasts change events so views can
 * re-render. Persistence funnels through `sink.save()`, which writes shopping
 * list state to a vault JSON file (so it syncs across devices) and plugin
 * settings to data.json.
 */
export class GroceryListManager extends Events {
	private items: GroceryItem[] = [];
	private recipeIngredients: RecipeIngredient[] = [];
	private individualRecipes: TFile[] = [];
	private plannedRecipes: PlannedRecipeEntry[] = [];
	private rebuildPromise: Promise<void> | null = null;

	constructor(
		private readonly app: App,
		private readonly sink: SaveSink,
	) {
		super();
	}

	getItems(): GroceryItem[] {
		return this.items;
	}

	getOneOffs(): OneOffItem[] {
		return this.sink.settings.state.oneOffs;
	}

	/** Recipes flagged via the selection property (excluding live meal-plan entries). */
	getIndividualRecipes(): TFile[] {
		return this.individualRecipes;
	}

	/** Recipes currently contributed by the live meal-plan source. */
	getPlannedRecipes(): PlannedRecipeEntry[] {
		return this.plannedRecipes;
	}

	/**
	 * Rebuild the grocery list from selected recipes and one-off items.
	 * Concurrent calls coalesce so spamming the refresh button is safe.
	 */
	async refresh(): Promise<void> {
		if (this.rebuildPromise) return this.rebuildPromise;
		this.rebuildPromise = (async () => {
			try {
				const fmFiles = findSelectedRecipes(
					this.app,
					this.sink.settings,
				);
				const plan = await this.readMealPlanOccurrences();

				// Count how many times each recipe appears in the meal plan so
				// duplicates contribute their ingredients once per appearance.
				const planCount = new Map<string, number>();
				const fileByPath = new Map<string, TFile>();
				for (const occ of plan.occurrences) {
					planCount.set(
						occ.file.path,
						(planCount.get(occ.file.path) ?? 0) + 1,
					);
					fileByPath.set(occ.file.path, occ.file);
				}

				// Plan wins over the frontmatter flag: a recipe in the plan is
				// counted by its plan appearances; frontmatter-only recipes
				// contribute a single time.
				const targets: Array<{ file: TFile; count: number }> = [];
				for (const [path, count] of planCount) {
					const file = fileByPath.get(path);
					if (file) targets.push({ file, count });
				}
				for (const file of fmFiles) {
					if (!planCount.has(file.path)) {
						targets.push({ file, count: 1 });
					}
				}

				const allIngredients: RecipeIngredient[] = [];
				for (const { file, count } of targets) {
					try {
						const parsed = await parseRecipeFile(
							this.app,
							file,
							this.sink.settings,
						);
						for (let i = 0; i < count; i++) {
							allIngredients.push(...parsed);
						}
					} catch (err) {
						console.error(
							`pantry: failed to parse ${file.path}`,
							err,
						);
					}
				}
				this.recipeIngredients = allIngredients;

				const planned: PlannedRecipeEntry[] = [];
				for (const [path, count] of planCount) {
					const file = fileByPath.get(path);
					if (file) planned.push({ file, count });
				}
				planned.sort((a, b) =>
					a.file.basename.localeCompare(b.file.basename, undefined, {
						sensitivity: "base",
					}),
				);

				const individual = fmFiles
					.filter((file) => !planCount.has(file.path))
					.sort((a, b) =>
						a.basename.localeCompare(b.basename, undefined, {
							sensitivity: "base",
						}),
					);

				this.plannedRecipes = planned;
				this.individualRecipes = individual;
				this.rebuildItems();
				await this.pruneStaleCheckedKeys();
			} finally {
				this.rebuildPromise = null;
			}
			this.trigger("changed");
		})();
		return this.rebuildPromise;
	}

	/** The configured meal-plan note, or null when unset/missing. */
	getMealPlanFile(): TFile | null {
		const path = this.sink.settings.mealPlanNotePath.trim();
		if (!path) return null;
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	/**
	 * Read the configured meal-plan note into recipe occurrences. Returns an
	 * empty result when the feature is disabled or the note is missing.
	 */
	async readMealPlanOccurrences(): Promise<{
		occurrences: PlanOccurrence[];
		unresolved: string[];
	}> {
		if (!this.sink.settings.mealPlanEnabled) {
			return { occurrences: [], unresolved: [] };
		}
		const file = this.getMealPlanFile();
		if (!file) return { occurrences: [], unresolved: [] };
		try {
			const contents = await this.app.vault.cachedRead(file);
			return parseMealPlanContents(
				this.app,
				file.path,
				contents,
				this.sink.settings,
			);
		} catch (err) {
			console.error(
				`pantry: failed to read meal plan ${file.path}`,
				err,
			);
			return { occurrences: [], unresolved: [] };
		}
	}

	/**
	 * Adopt a note as the active meal plan: point the setting at it, enable
	 * the meal-plan source, and rebuild the grocery list. Returns counts for
	 * a confirmation message.
	 */
	async adoptMealPlan(file: TFile): Promise<{
		recipes: number;
		occurrences: number;
		unresolved: number;
	}> {
		this.sink.settings.mealPlanNotePath = file.path;
		this.sink.settings.mealPlanEnabled = true;
		await this.sink.save();
		const parsed = await this.readMealPlanOccurrences();
		await this.refresh();
		const unique = new Set(parsed.occurrences.map((o) => o.file.path));
		return {
			recipes: unique.size,
			occurrences: parsed.occurrences.length,
			unresolved: parsed.unresolved.length,
		};
	}

	/** Flip the checked state of an item and persist it. */
	async toggleChecked(key: string, checked: boolean): Promise<void> {
		const map = this.sink.settings.state.checkedKeys;
		if (checked) {
			map[key] = true;
		} else {
			delete map[key];
		}
		const item = this.items.find((i) => i.key === key);
		if (item) item.checked = checked;
		if (checked && this.sink.settings.autoCollapseCompleted) {
			this.applyAutoCollapse(key);
		}
		await this.sink.save();
		this.trigger("changed");
	}

	/** Whether the named display group is currently collapsed. */
	isGroupCollapsed(name: string): boolean {
		return this.sink.settings.state.collapsedGroups[name] === true;
	}

	/** Set the collapsed state for a group and persist it. */
	async setGroupCollapsed(name: string, collapsed: boolean): Promise<void> {
		const map = this.sink.settings.state.collapsedGroups;
		const current = map[name] === true;
		if (current === collapsed) return;
		if (collapsed) {
			map[name] = true;
		} else {
			delete map[name];
		}
		await this.sink.save();
		this.trigger("changed");
	}

	/**
	 * After checking an item, find every group it belongs to and collapse any
	 * that are now fully checked. Only triggers on the transition to fully-checked
	 * (because this only runs when an item flips from unchecked to checked).
	 */
	private applyAutoCollapse(toggledKey: string): void {
		const groups = groupForDisplay(this.items, this.sink.settings);
		const collapsed = this.sink.settings.state.collapsedGroups;
		for (const [name, groupItems] of groups) {
			if (!groupItems.some((i) => i.key === toggledKey)) continue;
			if (collapsed[name] === true) continue;
			if (groupItems.every((i) => i.checked)) {
				collapsed[name] = true;
			}
		}
	}

	/** Add a one-off item to the list and persist it. */
	async addOneOff(item: Omit<OneOffItem, "id">): Promise<void> {
		const trimmedName = item.name.trim();
		if (!trimmedName) return;
		const id = `${Date.now().toString(36)}-${Math.random()
			.toString(36)
			.slice(2, 8)}`;
		this.sink.settings.state.oneOffs.push({
			id,
			name: trimmedName,
			quantity: item.quantity,
			unit: item.unit.trim(),
			category: item.category?.trim() || null,
		});
		await this.sink.save();
		this.rebuildItems();
		this.trigger("changed");
	}

	/** Update fields on an existing one-off item by id. Only provided fields change. */
	async updateOneOff(
		id: string,
		updates: {
			name?: string;
			quantity?: number | null;
			unit?: string;
			category?: string | null;
		},
	): Promise<void> {
		const item = this.sink.settings.state.oneOffs.find((o) => o.id === id);
		if (!item) return;
		if (updates.name !== undefined) {
			const trimmed = updates.name.trim();
			if (trimmed) item.name = trimmed;
		}
		if (updates.quantity !== undefined) {
			item.quantity = updates.quantity;
		}
		if (updates.unit !== undefined) {
			item.unit = updates.unit.trim();
		}
		if (updates.category !== undefined) {
			item.category = updates.category?.trim() || null;
		}
		await this.sink.save();
		this.rebuildItems();
		await this.pruneStaleCheckedKeys();
		this.trigger("changed");
	}

	/**
	 * Distinct categories currently known to the user: the configured
	 * `categoryOrder` plus any extra categories actively assigned to items.
	 * Sorted with the configured order first, then anything new alphabetically.
	 */
	getKnownCategories(): string[] {
		const ordered = this.sink.settings.categoryOrder ?? [];
		const seen = new Set<string>(ordered);
		const extra: string[] = [];
		for (const item of this.items) {
			const cat = item.category?.trim();
			if (!cat || seen.has(cat)) continue;
			seen.add(cat);
			extra.push(cat);
		}
		extra.sort((a, b) =>
			a.localeCompare(b, undefined, { sensitivity: "base" }),
		);
		return [...ordered, ...extra];
	}

	/** Remove a one-off item by id and persist. */
	async removeOneOff(id: string): Promise<void> {
		const before = this.sink.settings.state.oneOffs.length;
		this.sink.settings.state.oneOffs =
			this.sink.settings.state.oneOffs.filter((o) => o.id !== id);
		if (this.sink.settings.state.oneOffs.length === before) return;
		await this.sink.save();
		this.rebuildItems();
		await this.pruneStaleCheckedKeys();
		this.trigger("changed");
	}

	/**
	 * Clear the entire shopping list:
	 *   - unset the selection property on every recipe currently flagged
	 *   - stop the meal-plan note from contributing (without deleting it)
	 *   - drop all one-off items
	 *   - drop all checked-off state
	 */
	async clearAll(): Promise<{ recipesCleared: number; oneOffsCleared: number }> {
		const files = findSelectedRecipes(this.app, this.sink.settings);
		let recipesCleared = 0;
		for (const file of files) {
			try {
				await this.unsetSelectionProperty(file);
				recipesCleared++;
			} catch (err) {
				console.error(
					`pantry: failed to deselect ${file.path}`,
					err,
				);
			}
		}

		// Disable the live meal-plan source so a clear actually stays cleared.
		// The note itself is left untouched and can be re-imported later.
		this.sink.settings.mealPlanEnabled = false;
		const oneOffsCleared = this.sink.settings.state.oneOffs.length;
		this.sink.settings.state.oneOffs = [];
		this.sink.settings.state.checkedKeys = {};
		this.sink.settings.state.collapsedGroups = {};
		await this.sink.save();

		this.recipeIngredients = [];
		this.individualRecipes = [];
		this.plannedRecipes = [];
		this.items = [];
		this.trigger("changed");

		new Notice(
			`Grocery list cleared (${recipesCleared} recipe${recipesCleared === 1 ? "" : "s"}, ${oneOffsCleared} one-off${oneOffsCleared === 1 ? "" : "s"}).`,
		);
		return { recipesCleared, oneOffsCleared };
	}

	/** Reset only the checked state, keeping the list intact. */
	async resetChecks(): Promise<void> {
		this.sink.settings.state.checkedKeys = {};
		this.sink.settings.state.collapsedGroups = {};
		for (const item of this.items) item.checked = false;
		await this.sink.save();
		this.trigger("changed");
	}

	private rebuildItems(): void {
		const built = buildGroceryList({
			recipeIngredients: this.recipeIngredients,
			oneOffs: this.sink.settings.state.oneOffs,
			settings: this.sink.settings,
			checkedKeys: this.sink.settings.state.checkedKeys,
		});
		if (this.sink.settings.excludeInStockFromGrocery) {
			const inStock = buildInStockNameSet(this.sink.getInventoryItems());
			this.items = excludeInStockFromGrocery(built, inStock);
		} else {
			this.items = built;
		}
	}

	/**
	 * Re-apply inventory exclusion without rescanning recipes.
	 * Call when inventory stock toggles change.
	 */
	reapplyInventoryFilter(): void {
		this.rebuildItems();
		this.trigger("changed");
	}

	private async pruneStaleCheckedKeys(): Promise<void> {
		const live = new Set(this.items.map((i) => i.key));
		const map = this.sink.settings.state.checkedKeys;
		let changed = false;
		for (const key of Object.keys(map)) {
			if (!live.has(key)) {
				delete map[key];
				changed = true;
			}
		}
		if (changed) await this.sink.save();
	}

	private async unsetSelectionProperty(file: TFile): Promise<void> {
		const property = this.sink.settings.selectionProperty;
		await this.app.fileManager.processFrontMatter(
			file,
			(fm: Record<string, unknown>) => {
				if (fm[property] !== undefined) {
					fm[property] = false;
				}
			},
		);
	}
}

/**
 * Helper for parsing a free-form one-off entry like "2 cans black beans" so
 * the modal doesn't need to know about ingredient grammar.
 */
export function parseOneOffEntry(
	input: string,
): { name: string; quantity: number | null; unit: string } | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const parsed = parseIngredientLine(trimmed);
	if (!parsed) return null;
	return {
		name: parsed.name,
		quantity: parsed.quantity,
		unit: parsed.unit,
	};
}

/** Re-exported for callers that want to compute a key directly. */
export { ingredientKey, normaliseName };
