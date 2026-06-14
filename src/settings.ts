import { DEFAULT_GI_DICTIONARY } from "./parser/glycemic";
import {
	CategoryOverride,
	CategorySource,
	GroupingMode,
	OneOffItem,
} from "./types";

export interface PantrySettings {
	/** Folder paths (vault-relative) to scan for recipes. Empty array = entire vault. */
	recipeFolders: string[];
	/** Frontmatter property name that marks a recipe as selected for the week. */
	selectionProperty: string;
	/** Heading whose bullet list contains the recipe's ingredients. */
	ingredientsHeading: string;
	/** Heading whose ordered list contains the recipe's cooking steps. */
	instructionsHeading: string;
	/** How items should be grouped in the grocery list view. */
	grouping: GroupingMode;
	/** Where each item's category comes from. */
	categorySource: CategorySource;
	/** Order of categories. Unknown categories appear at the end alphabetically. */
	categoryOrder: string[];
	/** User-defined category overrides applied before the built-in categorizer. */
	categoryOverrides: CategoryOverride[];
	/** Auto-collapse a section when its last unchecked item gets checked. */
	autoCollapseCompleted: boolean;
	/** Auto-open notes whose recipe-type frontmatter matches `recipeTypeValue` in the recipe view. */
	autoOpenRecipeView: boolean;
	/** Frontmatter property name read to identify a recipe note (default: "type"). */
	recipeTypeProperty: string;
	/** The frontmatter value (under `recipeTypeProperty`) that marks a recipe (default: "recipe"). */
	recipeTypeValue: string;
	/** Hide the first matching inline body image when the recipe has image frontmatter. */
	suppressInlineRecipeImage: boolean;
	/** How nutrition values are displayed in the recipe view. */
	nutritionDisplay: NutritionDisplay;
	/** When true, writes today's date to a recipe's frontmatter when it's added to the grocery list. */
	trackLastMade: boolean;
	/** Frontmatter property name used to record the last time a recipe was added to the grocery list. */
	lastMadeProperty: string;
	/** When true, increments `cookedCount` whenever `lastMade` is stamped to a new day. */
	trackCookedCount: boolean;
	/** Allergen tags the user wants to be warned about (lowercase). */
	myAllergens: string[];
	/** Recipes cooked within this many days are excluded from the meal recommender. */
	suggestionDayWindow: number;
	/** Default number of suggestions the recommender surfaces. */
	suggestionCount: number;
	/** Master toggle for diabetes-aware features (currently the high-GI ingredient badges). */
	diabeticMode: boolean;
	/** User-editable high-GI dictionary as raw text. One regex per line, `#` comments. */
	giDictionary: string;
	/** When true, the meal-plan note contributes its linked recipes to the grocery list. */
	mealPlanEnabled: boolean;
	/** Vault-relative path of the meal-plan note Pantry reads from and the planner writes to. */
	mealPlanNotePath: string;
	/** Whether the planner exposes a fourth "Snacks" slot in addition to Breakfast/Lunch/Dinner. */
	mealPlanIncludeSnacks: boolean;
	/** Whether the planner includes Saturday and Sunday in addition to the weekdays. */
	mealPlanIncludeWeekend: boolean;
	/** Default vault-relative folder for recipes imported from a URL. Empty = first recipe folder. */
	importFolder: string;
	/** Optional vault note used as the import template. Empty = built-in Pantry template. */
	importTemplatePath: string;
	/** Persisted state - kept in the same data file so a single saveData() round-trip is enough. */
	state: PantrySavedState;
}

export type NutritionDisplay = "per-serving" | "total";

export interface PantrySavedState {
	/** One-off shopping items the user has added manually. */
	oneOffs: OneOffItem[];
	/**
	 * Map from item key to checked status. Survives refreshes so that recomputing
	 * the list from recipes doesn't lose the user's progress while shopping.
	 */
	checkedKeys: Record<string, boolean>;
	/**
	 * Map from grouping section name to whether the user has it collapsed.
	 * Missing entries default to expanded.
	 */
	collapsedGroups: Record<string, boolean>;
}

export const DEFAULT_CATEGORY_ORDER = [
	"Produce",
	"Herb",
	"Bread",
	"Meat",
	"Seafood",
	"Dairy",
	"Cheese",
	"Egg",
	"Pasta",
	"Grain",
	"Canned",
	"Broth",
	"Sauce",
	"Condiment",
	"Oil",
	"Seasoning",
	"Baking",
	"Pantry",
	"Snack",
	"Frozen",
	"Beverage",
	"Drinks",
	"Alcohol",
	"Foreign",
	"Household",
	"Other",
];

export const DEFAULT_SETTINGS: PantrySettings = {
	recipeFolders: [],
	selectionProperty: "groceryList",
	ingredientsHeading: "Ingredients",
	instructionsHeading: "Instructions",
	grouping: "category",
	categorySource: "dictionary",
	categoryOrder: [...DEFAULT_CATEGORY_ORDER],
	categoryOverrides: [],
	autoCollapseCompleted: true,
	autoOpenRecipeView: true,
	recipeTypeProperty: "type",
	recipeTypeValue: "recipe",
	suppressInlineRecipeImage: false,
	nutritionDisplay: "per-serving",
	trackLastMade: true,
	lastMadeProperty: "lastMade",
	trackCookedCount: true,
	myAllergens: [],
	suggestionDayWindow: 14,
	suggestionCount: 5,
	diabeticMode: false,
	giDictionary: DEFAULT_GI_DICTIONARY,
	mealPlanEnabled: false,
	mealPlanNotePath: "",
	mealPlanIncludeSnacks: true,
	mealPlanIncludeWeekend: false,
	importFolder: "",
	importTemplatePath: "",
	state: {
		oneOffs: [],
		checkedKeys: {},
		collapsedGroups: {},
	},
};

/** Canonical weekday order used by the planner grid and note serializer. */
export const MEAL_PLAN_DAYS = [
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
] as const;

/** Meal slots within a day. The final "Snacks" slot is gated by a setting. */
export const MEAL_PLAN_SLOTS = [
	"Breakfast",
	"Lunch",
	"Dinner",
	"Snacks",
] as const;

/** Marker comment written at the top of planner-managed meal-plan notes. */
export const MEAL_PLAN_MARKER = "<!-- pantry:meal-plan -->";

/** Slots active given the current settings (drops "Snacks" when disabled). */
export function activeMealSlots(settings: PantrySettings): string[] {
	return settings.mealPlanIncludeSnacks
		? [...MEAL_PLAN_SLOTS]
		: MEAL_PLAN_SLOTS.filter((s) => s !== "Snacks");
}

/** Weekend day names, dropped from the planner grid unless enabled. */
const MEAL_PLAN_WEEKEND_DAYS = ["Saturday", "Sunday"];

/** Days active given the current settings (drops the weekend when disabled). */
export function activeMealDays(settings: PantrySettings): string[] {
	return settings.mealPlanIncludeWeekend
		? [...MEAL_PLAN_DAYS]
		: MEAL_PLAN_DAYS.filter(
				(d) => !MEAL_PLAN_WEEKEND_DAYS.includes(d),
			);
}

/**
 * Frontmatter property names the recipe view reads and writes.
 * Kept as a constant so anywhere we touch frontmatter uses the same keys.
 */
export const RECIPE_FRONTMATTER = {
	type: "type",
	image: "image",
	multiplier: "multiplier",
	servings: "servings",
	calories: "calories",
	protein: "protein",
	fat: "fat",
	carbs: "carbs",
	diet: "diet",
	allergens: "allergens",
	prepTime: "prepTime",
	cookTime: "cookTime",
	totalTime: "totalTime",
	favorite: "favorite",
	cookedCount: "cookedCount",
} as const;
