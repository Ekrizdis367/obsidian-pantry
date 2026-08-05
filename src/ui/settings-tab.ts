import {
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TextAreaComponent,
	type SettingDefinitionItem,
} from "obsidian";
import { GroceryListManager } from "../grocery/manager";
import {
	formatStatusValuesInput,
	parseStatusValuesInput,
} from "../grocery/meal-plan-fill";
import {
	DEFAULT_GI_DICTIONARY,
	validateGiDictionary,
} from "../parser/glycemic";
import {
	DEFAULT_AUTO_FILL_STATUS_VALUES,
	DEFAULT_CATEGORY_ORDER,
	DEFAULT_SHOPPING_STATE_PATH,
	MEAL_PLAN_SLOTS,
	normalizeMealPlanSlots,
	PantrySettings,
} from "../settings";
import { RECIPE_TEMPLATE_TOKEN_HINT } from "../importer/default-template";

export interface SettingsHost {
	settings: PantrySettings;
	saveSettings(): Promise<void>;
	manager: GroceryListManager;
	/** Reload shopping list state from the vault (after the path setting changes). */
	reloadShoppingState(): Promise<void>;
}

/**
 * Declarative settings tab (Obsidian 1.13+).
 * `getSettingDefinitions()` drives UI and settings search.
 */
export class PantrySettingsTab extends PluginSettingTab {
	constructor(
		plugin: Plugin,
		private readonly host: SettingsHost,
	) {
		super(plugin.app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				items: [
					{
						name: "Recipe folders",
						desc: "Vault-relative folder paths to scan for recipes, one per line. Leave blank to scan the entire vault.",
						render: (setting) => this.wireRecipeFolders(setting),
					},
					{
						name: "Selection property",
						desc: "Frontmatter property that marks a recipe as part of this week's grocery list (boolean).",
						render: (setting) => this.wireSelectionProperty(setting),
					},
					{
						name: "Ingredients heading",
						desc: "Heading that introduces the bullet list of ingredients in each recipe (case-insensitive).",
						render: (setting) => this.wireIngredientsHeading(setting),
					},
					{
						name: "Instructions heading",
						desc: "Heading that introduces the numbered cooking steps in each recipe (case-insensitive).",
						render: (setting) => this.wireInstructionsHeading(setting),
					},
					{
						name: "Default grouping",
						desc: "How items are grouped in the grocery list view.",
						render: (setting) => this.wireGrouping(setting),
					},
					{
						name: "Auto-collapse completed sections",
						desc: "Collapse a section automatically once every item in it is checked off.",
						render: (setting) =>
							this.wireAutoCollapseCompleted(setting),
					},
					{
						name: "Shopping state file",
						desc: "Vault-relative JSON file for one-off items, checks, and collapsed sections. Stored in the vault so it syncs across devices with your notes.",
						render: (setting) =>
							this.wireShoppingStatePath(setting),
					},
				],
			},
			{
				type: "group",
				heading: "Recipe view",
				items: [
					{
						name: "Auto-open recipe view",
						desc: "Open notes whose recipe type matches the property and value below in the recipe view automatically.",
						render: (setting) => this.wireAutoOpenRecipeView(setting),
					},
					{
						name: "Recipe type property",
						desc: "The frontmatter property name checked to identify a recipe note (e.g. `type`, `category`, `kind`).",
						render: (setting) => this.wireRecipeTypeProperty(setting),
					},
					{
						name: "Recipe type value",
						desc: "A note opens in the recipe view when the property above matches this value (case-insensitive). Wikilink values like `[[Recipes]]` are matched against their note name.",
						render: (setting) => this.wireRecipeTypeValue(setting),
					},
					{
						name: "Suppress duplicate inline image",
						desc: "When image frontmatter is set, hide the first matching image embedded in the recipe body.",
						render: (setting) =>
							this.wireSuppressInlineRecipeImage(setting),
					},
					{
						name: "Nutrition display",
						desc: "Show nutrition values per serving (when the recipe declares servings) or as recipe totals.",
						render: (setting) => this.wireNutritionDisplay(setting),
					},
					{
						name: "Track last made date",
						desc: "When a recipe is added to the grocery list, write today's date to its frontmatter so you can see the last time you cooked it.",
						render: (setting) => this.wireTrackLastMade(setting),
					},
					{
						name: "Last made property",
						desc: "Frontmatter property used to store the last made date.",
						render: (setting) => this.wireLastMadeProperty(setting),
					},
					{
						name: "Track cooked count",
						desc: "Increment the recipe's `cookedCount` frontmatter when it's added to the grocery list on a new day. Powers the cooking stats leaderboard.",
						render: (setting) => this.wireTrackCookedCount(setting),
					},
				],
			},
			{
				type: "group",
				heading: "Recipe import",
				items: [
					{
						name: "Import folder",
						desc: "Default vault-relative folder for recipes imported from a URL. Leave blank to use the first recipe folder above.",
						render: (setting) => this.wireImportFolder(setting),
					},
					{
						name: "Import template note",
						desc: `Optional vault note used as the import template. Leave blank for the built-in Pantry template. Tokens: ${RECIPE_TEMPLATE_TOKEN_HINT}.`,
						render: (setting) => this.wireImportTemplatePath(setting),
					},
				],
			},
			{
				type: "group",
				heading: "Recipe library",
				items: [
					{
						name: "My allergens",
						desc: "Comma-separated allergens to warn about. Recipes with a matching `allergens` frontmatter entry show a red warning.",
						render: (setting) => this.wireMyAllergens(setting),
					},
					{
						name: "Suggestion day window",
						desc: "Recipes cooked within this many days are excluded from the meal recommender. Set to 0 to never exclude.",
						render: (setting) =>
							this.wireSuggestionDayWindow(setting),
					},
					{
						name: "Suggestion count",
						desc: "How many recipes the meal recommender surfaces at once.",
						render: (setting) => this.wireSuggestionCount(setting),
					},
				],
			},
			{
				type: "group",
				heading: "Meal planning",
				items: [
					{
						name: "Auto-sync meal plan to the shopping list",
						desc: "When on, the meal-plan note continuously contributes its linked recipes to the grocery list as you edit the planner. A recipe listed multiple times is counted once per appearance. Off by default — use the add-to-grocery-list button in the planner for a one-time add instead. Clearing the list turns this back off.",
						render: (setting) => this.wireMealPlanEnabled(setting),
					},
					{
						name: "Meal plan note",
						desc: "Vault-relative path of the note the planner reads and writes. The planner creates it if it doesn't exist.",
						render: (setting) => this.wireMealPlanNotePath(setting),
					},
					{
						name: "Planner meal slots",
						desc: "Choose which meals appear in each day. Select dinner only for a dinners-only plan, or enable all four for full weekly meal planning.",
					},
					...MEAL_PLAN_SLOTS.map((slot) => ({
						name: slot,
						render: (setting: Setting) =>
							this.wireMealPlanSlot(setting, slot),
					})),
					{
						name: "Include weekend days",
						desc: "Show weekend days in the planner. Off by default, so the planner covers weekdays only.",
						render: (setting) =>
							this.wireMealPlanIncludeWeekend(setting),
					},
					{
						name: "Auto-fill status property",
						desc: "Frontmatter field used when auto-filling empty planner slots. Lower numeric values are weighted more heavily.",
						render: (setting) =>
							this.wireAutoFillStatusProperty(setting),
					},
					{
						name: "Auto-fill status values",
						desc: "Comma-separated numbers eligible for auto-fill (e.g. 1, 2, 3, 4, 5). Lower values are weighted more heavily. Only empty slots are filled; existing picks are never replaced.",
						render: (setting) =>
							this.wireAutoFillStatusValues(setting),
					},
					{
						name: "Auto-fill meal property",
						desc: "Frontmatter list matched against each planner slot (breakfast, lunch, dinner, snacks). Recipes with no value are eligible for any slot.",
						render: (setting) =>
							this.wireAutoFillMealProperty(setting),
					},
				],
			},
			{
				type: "group",
				heading: "Diabetic mode",
				items: [
					{
						name: "Enable diabetic mode",
						desc: "Show high glycemic index warnings on ingredients in the recipe view. When off, no diabetic-related UI appears.",
						render: (setting) => this.wireDiabeticMode(setting),
					},
					{
						name: "High glycemic index dictionary",
						desc: "One regex per line, case-insensitive. Lines starting with # are comments. Patterns are matched against ingredient names; matches earn an up-arrow badge in the recipe view. Glycemic index values vary by source - this list is informational, not medical advice.",
						visible: () => this.host.settings.diabeticMode,
						render: (setting) => this.wireGiDictionary(setting),
					},
					{
						name: "Reset glycemic index dictionary",
						desc: "Restore the shipped list of widely-cited high glycemic index foods.",
						visible: () => this.host.settings.diabeticMode,
						render: (setting) => this.wireResetGiDictionary(setting),
					},
				],
			},
			{
				type: "group",
				heading: "Categories",
				items: [
					{
						name: "Category source",
						desc: "Where each item's category comes from. Tag modes use the trailing tag on each ingredient line as the category name.",
						render: (setting) => this.wireCategorySource(setting),
					},
					{
						name: "Category order",
						desc: "Order in which categories appear, one per line. Unknown categories appear after these in alphabetical order.",
						render: (setting) => this.wireCategoryOrder(setting),
					},
					{
						name: "Category overrides",
						desc: "One per line as 'match: category'. Matches are lowercase substrings of the ingredient name.",
						render: (setting) => this.wireCategoryOverrides(setting),
					},
					{
						name: "Reset categories",
						desc: "Restore the default category order.",
						render: (setting) => this.wireResetCategories(setting),
					},
				],
			},
		];
	}

	/** Re-render after structural setting changes. */
	private reloadSettings(): void {
		this.update();
	}

	private wireRecipeFolders(setting: Setting): void {
		setting.addTextArea((ta) => configureFoldersTextarea(ta, this.host));
	}

	private wireSelectionProperty(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Property name")
				.setValue(this.host.settings.selectionProperty)
				.onChange(async (value) => {
					this.host.settings.selectionProperty =
						value.trim() || "groceryList";
					await this.host.saveSettings();
				}),
		);
	}

	private wireIngredientsHeading(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Ingredients")
				.setValue(this.host.settings.ingredientsHeading)
				.onChange(async (value) => {
					this.host.settings.ingredientsHeading =
						value.trim() || "Ingredients";
					await this.host.saveSettings();
				}),
		);
	}

	private wireInstructionsHeading(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Instructions")
				.setValue(this.host.settings.instructionsHeading)
				.onChange(async (value) => {
					this.host.settings.instructionsHeading =
						value.trim() || "Instructions";
					await this.host.saveSettings();
				}),
		);
	}

	private wireGrouping(setting: Setting): void {
		setting.addDropdown((dd) =>
			dd
				.addOptions({
					category: "By category",
					recipe: "By recipe",
					none: "Flat list",
				})
				.setValue(this.host.settings.grouping)
				.onChange(async (value) => {
					this.host.settings.grouping =
						value as PantrySettings["grouping"];
					await this.host.saveSettings();
					this.host.manager.trigger("changed");
				}),
		);
	}

	private wireAutoCollapseCompleted(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.host.settings.autoCollapseCompleted)
				.onChange(async (value) => {
					this.host.settings.autoCollapseCompleted = value;
					await this.host.saveSettings();
				}),
		);
	}

	private wireShoppingStatePath(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder(DEFAULT_SHOPPING_STATE_PATH)
				.setValue(this.host.settings.shoppingStatePath)
				.onChange(async (value) => {
					const next = value.trim() || DEFAULT_SHOPPING_STATE_PATH;
					if (next === this.host.settings.shoppingStatePath) return;
					this.host.settings.shoppingStatePath = next;
					await this.host.saveSettings();
					await this.host.reloadShoppingState();
					await this.host.manager.refresh();
				}),
		);
	}

	private wireAutoOpenRecipeView(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.host.settings.autoOpenRecipeView)
				.onChange(async (value) => {
					this.host.settings.autoOpenRecipeView = value;
					await this.host.saveSettings();
				}),
		);
	}

	private wireRecipeTypeProperty(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Type")
				.setValue(this.host.settings.recipeTypeProperty)
				.onChange(async (value) => {
					this.host.settings.recipeTypeProperty =
						value.trim() || "type";
					await this.host.saveSettings();
				}),
		);
	}

	private wireRecipeTypeValue(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Recipe")
				.setValue(this.host.settings.recipeTypeValue)
				.onChange(async (value) => {
					this.host.settings.recipeTypeValue =
						value.trim() || "recipe";
					await this.host.saveSettings();
				}),
		);
	}

	private wireSuppressInlineRecipeImage(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.host.settings.suppressInlineRecipeImage)
				.onChange(async (value) => {
					this.host.settings.suppressInlineRecipeImage = value;
					await this.host.saveSettings();
				}),
		);
	}

	private wireNutritionDisplay(setting: Setting): void {
		setting.addDropdown((dd) =>
			dd
				.addOptions({
					"per-serving": "Per serving",
					total: "Total",
				})
				.setValue(this.host.settings.nutritionDisplay)
				.onChange(async (value) => {
					this.host.settings.nutritionDisplay =
						value as PantrySettings["nutritionDisplay"];
					await this.host.saveSettings();
				}),
		);
	}

	private wireTrackLastMade(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.host.settings.trackLastMade)
				.onChange(async (value) => {
					this.host.settings.trackLastMade = value;
					await this.host.saveSettings();
				}),
		);
	}

	private wireLastMadeProperty(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Property name")
				.setValue(this.host.settings.lastMadeProperty)
				.onChange(async (value) => {
					this.host.settings.lastMadeProperty =
						value.trim() || "lastMade";
					await this.host.saveSettings();
				}),
		);
	}

	private wireTrackCookedCount(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.host.settings.trackCookedCount)
				.onChange(async (value) => {
					this.host.settings.trackCookedCount = value;
					await this.host.saveSettings();
				}),
		);
	}

	private wireImportFolder(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Recipes")
				.setValue(this.host.settings.importFolder)
				.onChange(async (value) => {
					this.host.settings.importFolder = value.trim();
					await this.host.saveSettings();
				}),
		);
	}

	private wireImportTemplatePath(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Templates/Pantry recipe.md")
				.setValue(this.host.settings.importTemplatePath)
				.onChange(async (value) => {
					this.host.settings.importTemplatePath = value.trim();
					await this.host.saveSettings();
				}),
		);
	}

	private wireMyAllergens(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Comma-separated list")
				.setValue(this.host.settings.myAllergens.join(", "))
				.onChange(async (value) => {
					this.host.settings.myAllergens = value
						.split(",")
						.map((s) => s.trim().toLowerCase())
						.filter(Boolean);
					await this.host.saveSettings();
					this.host.manager.trigger("changed");
				}),
		);
	}

	private wireSuggestionDayWindow(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("14")
				.setValue(String(this.host.settings.suggestionDayWindow))
				.onChange(async (value) => {
					const n = Number(value);
					if (Number.isFinite(n) && n >= 0) {
						this.host.settings.suggestionDayWindow = Math.round(n);
						await this.host.saveSettings();
					}
				}),
		);
	}

	private wireSuggestionCount(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("5")
				.setValue(String(this.host.settings.suggestionCount))
				.onChange(async (value) => {
					const n = Number(value);
					if (Number.isFinite(n) && n >= 1) {
						this.host.settings.suggestionCount = Math.round(n);
						await this.host.saveSettings();
					}
				}),
		);
	}

	private wireMealPlanEnabled(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.host.settings.mealPlanEnabled)
				.onChange(async (value) => {
					this.host.settings.mealPlanEnabled = value;
					await this.host.saveSettings();
					await this.host.manager.refresh();
				}),
		);
	}

	private wireMealPlanNotePath(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Meal-plan.md")
				.setValue(this.host.settings.mealPlanNotePath)
				.onChange(async (value) => {
					this.host.settings.mealPlanNotePath = value.trim();
					await this.host.saveSettings();
					await this.host.manager.refresh();
				}),
		);
	}

	private wireMealPlanSlot(setting: Setting, slot: string): void {
		setting.addToggle((toggle) => {
			toggle.setValue(
				this.host.settings.mealPlanSlots.some(
					(s) => s.toLowerCase() === slot.toLowerCase(),
				),
			);
			toggle.onChange(async (enabled) => {
				const current = new Set(
					this.host.settings.mealPlanSlots.map((s) =>
						s.toLowerCase(),
					),
				);
				const key = slot.toLowerCase();
				if (enabled) {
					current.add(key);
				} else {
					if (current.size <= 1) {
						new Notice("Keep at least one meal slot enabled.");
						toggle.setValue(true);
						return;
					}
					current.delete(key);
				}
				this.host.settings.mealPlanSlots = normalizeMealPlanSlots(
					[...MEAL_PLAN_SLOTS].filter((s) =>
						current.has(s.toLowerCase()),
					),
				);
				await this.host.saveSettings();
			});
		});
	}

	private wireMealPlanIncludeWeekend(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.host.settings.mealPlanIncludeWeekend)
				.onChange(async (value) => {
					this.host.settings.mealPlanIncludeWeekend = value;
					await this.host.saveSettings();
				}),
		);
	}

	private wireAutoFillStatusProperty(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Property name")
				.setValue(this.host.settings.autoFillStatusProperty)
				.onChange(async (value) => {
					this.host.settings.autoFillStatusProperty =
						value.trim() || "status";
					await this.host.saveSettings();
				}),
		);
	}

	private wireAutoFillStatusValues(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("1, 2, 3, 4, 5")
				.setValue(
					formatStatusValuesInput(
						this.host.settings.autoFillStatusValues,
					),
				)
				.onChange(async (value) => {
					const parsed = parseStatusValuesInput(value);
					this.host.settings.autoFillStatusValues =
						parsed.length > 0
							? parsed
							: [...DEFAULT_AUTO_FILL_STATUS_VALUES];
					await this.host.saveSettings();
				}),
		);
	}

	private wireAutoFillMealProperty(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Property name")
				.setValue(this.host.settings.autoFillMealProperty)
				.onChange(async (value) => {
					this.host.settings.autoFillMealProperty =
						value.trim() || "meal";
					await this.host.saveSettings();
				}),
		);
	}

	private wireDiabeticMode(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.host.settings.diabeticMode)
				.onChange(async (value) => {
					this.host.settings.diabeticMode = value;
					await this.host.saveSettings();
					this.reloadSettings();
				}),
		);
	}

	private wireGiDictionary(setting: Setting): void {
		const errorEl = setting.settingEl.createDiv({
			cls: "pantry-settings-gi-errors",
		});

		setting.addTextArea((ta) => {
			ta.setValue(this.host.settings.giDictionary);
			ta.inputEl.rows = 12;
			ta.inputEl.addClass("pantry-settings-gi-textarea");
			ta.onChange(async (value) => {
				this.host.settings.giDictionary = value;
				await this.host.saveSettings();
				renderErrors(errorEl, validateGiDictionary(value));
			});
		});

		renderErrors(
			errorEl,
			validateGiDictionary(this.host.settings.giDictionary),
		);
	}

	private wireResetGiDictionary(setting: Setting): void {
		setting.addButton((btn) =>
			btn.setButtonText("Reset").onClick(async () => {
				this.host.settings.giDictionary = DEFAULT_GI_DICTIONARY;
				await this.host.saveSettings();
				this.reloadSettings();
			}),
		);
	}

	private wireCategorySource(setting: Setting): void {
		setting.addDropdown((dd) =>
			dd
				.addOptions({
					dictionary: "Built-in dictionary",
					tag: "Recipe tags",
					"tag-then-dictionary": "Recipe tags, then dictionary",
				})
				.setValue(this.host.settings.categorySource)
				.onChange(async (value) => {
					this.host.settings.categorySource =
						value as PantrySettings["categorySource"];
					await this.host.saveSettings();
					this.host.manager.trigger("changed");
				}),
		);
	}

	private wireCategoryOrder(setting: Setting): void {
		setting.addTextArea((ta) => {
			ta.setPlaceholder(DEFAULT_CATEGORY_ORDER.join("\n"));
			ta.setValue(this.host.settings.categoryOrder.join("\n"));
			ta.onChange(async (value) => {
				this.host.settings.categoryOrder = value
					.split(/\r?\n/)
					.map((s) => s.trim())
					.filter(Boolean);
				await this.host.saveSettings();
				this.host.manager.trigger("changed");
			});
			ta.inputEl.rows = 6;
		});
	}

	private wireCategoryOverrides(setting: Setting): void {
		setting.addTextArea((ta) => {
			ta.setPlaceholder("Match: category, one per line");
			ta.setValue(
				this.host.settings.categoryOverrides
					.map((o) => `${o.match}: ${o.category}`)
					.join("\n"),
			);
			ta.onChange(async (value) => {
				const overrides = value
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(Boolean)
					.map((line) => {
						const idx = line.indexOf(":");
						if (idx === -1) return null;
						const match = line.slice(0, idx).trim();
						const category = line.slice(idx + 1).trim();
						if (!match || !category) return null;
						return { match, category };
					})
					.filter(
						(v): v is { match: string; category: string } =>
							v !== null,
					);
				this.host.settings.categoryOverrides = overrides;
				await this.host.saveSettings();
				this.host.manager.trigger("changed");
			});
			ta.inputEl.rows = 6;
		});
	}

	private wireResetCategories(setting: Setting): void {
		setting.addButton((btn) =>
			btn.setButtonText("Reset").onClick(async () => {
				this.host.settings.categoryOrder = [...DEFAULT_CATEGORY_ORDER];
				await this.host.saveSettings();
				this.reloadSettings();
				this.host.manager.trigger("changed");
			}),
		);
	}
}

function renderErrors(container: HTMLElement, errors: readonly string[]): void {
	container.empty();
	if (errors.length === 0) return;
	container.createDiv({
		cls: "pantry-settings-gi-errors-title",
		text: `${errors.length} invalid pattern${errors.length === 1 ? "" : "s"} (skipped):`,
	});
	const list = container.createEl("ul", {
		cls: "pantry-settings-gi-errors-list",
	});
	for (const err of errors) {
		list.createEl("li", { text: err });
	}
}

function configureFoldersTextarea(
	ta: TextAreaComponent,
	host: SettingsHost,
): void {
	ta.setPlaceholder("One folder path per line");
	ta.setValue(host.settings.recipeFolders.join("\n"));
	ta.onChange(async (value) => {
		host.settings.recipeFolders = value
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		await host.saveSettings();
	});
	ta.inputEl.rows = 4;
}
