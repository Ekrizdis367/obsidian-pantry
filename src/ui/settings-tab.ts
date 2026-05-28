import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TextAreaComponent,
} from "obsidian";
import { GroceryListManager } from "../grocery/manager";
import {
	DEFAULT_GI_DICTIONARY,
	validateGiDictionary,
} from "../parser/glycemic";
import {
	DEFAULT_CATEGORY_ORDER,
	PantrySettings,
} from "../settings";

export interface SettingsHost {
	app: App;
	settings: PantrySettings;
	saveSettings(): Promise<void>;
	manager: GroceryListManager;
}

export class PantrySettingsTab extends PluginSettingTab {
	constructor(
		plugin: Plugin,
		private readonly host: SettingsHost,
	) {
		super(plugin.app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Recipe folders")
			.setDesc(
				"Vault-relative folder paths to scan for recipes, one per line. Leave blank to scan the entire vault.",
			)
			.addTextArea((ta) =>
				configureFoldersTextarea(ta, this.host),
			);

		new Setting(containerEl)
			.setName("Selection property")
			.setDesc(
				"Frontmatter property that marks a recipe as part of this week's grocery list (boolean).",
			)
			.addText((text) =>
				text
					.setPlaceholder("Property name")
					.setValue(this.host.settings.selectionProperty)
					.onChange(async (value) => {
						this.host.settings.selectionProperty =
							value.trim() || "groceryList";
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Ingredients heading")
			.setDesc(
				"Heading that introduces the bullet list of ingredients in each recipe (case-insensitive).",
			)
			.addText((text) =>
				text
					.setPlaceholder("Ingredients")
					.setValue(this.host.settings.ingredientsHeading)
					.onChange(async (value) => {
						this.host.settings.ingredientsHeading =
							value.trim() || "Ingredients";
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Instructions heading")
			.setDesc(
				"Heading that introduces the numbered cooking steps in each recipe (case-insensitive).",
			)
			.addText((text) =>
				text
					.setPlaceholder("Instructions")
					.setValue(this.host.settings.instructionsHeading)
					.onChange(async (value) => {
						this.host.settings.instructionsHeading =
							value.trim() || "Instructions";
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default grouping")
			.setDesc("How items are grouped in the grocery list view.")
			.addDropdown((dd) =>
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

		new Setting(containerEl)
			.setName("Auto-collapse completed sections")
			.setDesc(
				"Collapse a section automatically once every item in it is checked off.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.autoCollapseCompleted)
					.onChange(async (value) => {
						this.host.settings.autoCollapseCompleted = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Recipe view").setHeading();

		new Setting(containerEl)
			.setName("Auto-open recipe view")
			.setDesc(
				"Open notes whose `type` matches the value below in the recipe view automatically.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.autoOpenRecipeView)
					.onChange(async (value) => {
						this.host.settings.autoOpenRecipeView = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Recipe `type` value")
			.setDesc(
				"A note opens in the recipe view when its frontmatter `type` matches this value (case-insensitive).",
			)
			.addText((text) =>
				text
					.setPlaceholder("Recipe")
					.setValue(this.host.settings.recipeTypeValue)
					.onChange(async (value) => {
						this.host.settings.recipeTypeValue =
							value.trim() || "recipe";
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Nutrition display")
			.setDesc(
				"Show nutrition values per serving (when the recipe declares servings) or as recipe totals.",
			)
			.addDropdown((dd) =>
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

		new Setting(containerEl)
			.setName("Nutrition source")
			.setDesc(
				"Whether your frontmatter nutrition fields are saved as totals for the whole recipe or already per serving.",
			)
			.addDropdown((dd) =>
				dd
					.addOptions({
						"recipe-total": "Recipe total",
						"per-serving": "Per serving",
					})
					.setValue(this.host.settings.nutritionSource)
					.onChange(async (value) => {
						this.host.settings.nutritionSource =
							value as PantrySettings["nutritionSource"];
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Show mark as cooked button")
			.setDesc(
				"Display a button in the recipe view to manually mark the recipe as cooked, updating the last made date and cooked count.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.showMarkCookedButton)
					.onChange(async (value) => {
						this.host.settings.showMarkCookedButton = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Ask for date when marking cooked")
			.setDesc(
				"When enabled, clicking the mark as cooked button opens a date picker instead of using today's date.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.markCookedAskDate)
					.onChange(async (value) => {
						this.host.settings.markCookedAskDate = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto track last made date when adding to grocery list")
			.setDesc(
				"When a recipe is added to the grocery list, write today's date to its frontmatter so you can see the last time you cooked it.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.trackLastMade)
					.onChange(async (value) => {
						this.host.settings.trackLastMade = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Last made property")
			.setDesc(
				"Frontmatter property used to store the last made date.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Property name")
					.setValue(this.host.settings.lastMadeProperty)
					.onChange(async (value) => {
						this.host.settings.lastMadeProperty =
							value.trim() || "lastMade";
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Track cooked count")
			.setDesc(
				"Increment the recipe's `cookedCount` frontmatter when it's added to the grocery list on a new day, or when manually marked as cooked. Powers the cooking stats leaderboard.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.trackCookedCount)
					.onChange(async (value) => {
						this.host.settings.trackCookedCount = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Recipe library").setHeading();

		new Setting(containerEl)
			.setName("My allergens")
			.setDesc(
				"Comma-separated allergens to warn about. Recipes with a matching `allergens` frontmatter entry show a red warning.",
			)
			.addText((text) =>
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

		new Setting(containerEl)
			.setName("Suggestion day window")
			.setDesc(
				"Recipes cooked within this many days are excluded from the meal recommender. Set to 0 to never exclude.",
			)
			.addText((text) =>
				text
					.setPlaceholder("14")
					.setValue(String(this.host.settings.suggestionDayWindow))
					.onChange(async (value) => {
						const n = Number(value);
						if (Number.isFinite(n) && n >= 0) {
							this.host.settings.suggestionDayWindow =
								Math.round(n);
							await this.host.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Suggestion count")
			.setDesc("How many recipes the meal recommender surfaces at once.")
			.addText((text) =>
				text
					.setPlaceholder("5")
					.setValue(String(this.host.settings.suggestionCount))
					.onChange(async (value) => {
						const n = Number(value);
						if (Number.isFinite(n) && n >= 1) {
							this.host.settings.suggestionCount =
								Math.round(n);
							await this.host.saveSettings();
						}
					}),
			);

		new Setting(containerEl).setName("Diabetic mode").setHeading();

		new Setting(containerEl)
			.setName("Enable diabetic mode")
			.setDesc(
				"Show high glycemic index warnings on ingredients in the recipe view. When off, no diabetic-related UI appears.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.diabeticMode)
					.onChange(async (value) => {
						this.host.settings.diabeticMode = value;
						await this.host.saveSettings();
						this.display();
					}),
			);

		if (this.host.settings.diabeticMode) {
			this.renderGiDictionarySetting(containerEl);
		}

		new Setting(containerEl)
			.setName("Category source")
			.setDesc(
				"Where each item's category comes from. Tag modes use the trailing tag on each ingredient line as the category name.",
			)
			.addDropdown((dd) =>
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

		new Setting(containerEl)
			.setName("Category order")
			.setDesc(
				"Order in which categories appear, one per line. Unknown categories appear after these in alphabetical order.",
			)
			.addTextArea((ta) => {
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

		new Setting(containerEl)
			.setName("Category overrides")
			.setDesc(
				"One per line as 'match: category'. Matches are lowercase substrings of the ingredient name.",
			)
			.addTextArea((ta) => {
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
						.filter((v): v is { match: string; category: string } => v !== null);
					this.host.settings.categoryOverrides = overrides;
					await this.host.saveSettings();
					this.host.manager.trigger("changed");
				});
				ta.inputEl.rows = 6;
			});

		new Setting(containerEl)
			.setName("Reset categories")
			.setDesc("Restore the default category order.")
			.addButton((btn) =>
				btn.setButtonText("Reset").onClick(async () => {
					this.host.settings.categoryOrder = [
						...DEFAULT_CATEGORY_ORDER,
					];
					await this.host.saveSettings();
					this.display();
					this.host.manager.trigger("changed");
				}),
			);
	}

	private renderGiDictionarySetting(containerEl: HTMLElement): void {
		const setting = new Setting(containerEl)
			.setName("High glycemic index dictionary")
			.setDesc(
				"One regex per line, case-insensitive. Lines starting with # are comments. Patterns are matched against ingredient names; matches earn an up-arrow badge in the recipe view. Glycemic index values vary by source - this list is informational, not medical advice.",
			);

		const errorEl = containerEl.createDiv({
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

		new Setting(containerEl)
			.setName("Reset glycemic index dictionary")
			.setDesc(
				"Restore the shipped list of widely-cited high glycemic index foods.",
			)
			.addButton((btn) =>
				btn.setButtonText("Reset").onClick(async () => {
					this.host.settings.giDictionary = DEFAULT_GI_DICTIONARY;
					await this.host.saveSettings();
					this.display();
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
