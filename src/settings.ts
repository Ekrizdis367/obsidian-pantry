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
	/** Auto-open notes whose `type` matches `recipeTypeValue` in the recipe view. */
	autoOpenRecipeView: boolean;
	/** The frontmatter `type` value that triggers the recipe view (default: "recipe"). */
	recipeTypeValue: string;
	/** How nutrition values are displayed in the recipe view. */
	nutritionDisplay: NutritionDisplay;
	/** Whether frontmatter nutrition values are stored as recipe totals or per-serving values. */
	nutritionSource: NutritionSource;
	/** Show a "Mark as cooked" button in the recipe view action bar. */
	showMarkCookedButton: boolean;
	/** When true, clicking "Mark as cooked" prompts for a date instead of using today. */
	markCookedAskDate: boolean;
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
	/** Persisted state - kept in the same data file so a single saveData() round-trip is enough. */
	state: PantrySavedState;
}

export type NutritionDisplay = "per-serving" | "total";
export type NutritionSource = "recipe-total" | "per-serving";

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
	recipeTypeValue: "recipe",
	nutritionDisplay: "per-serving",
	nutritionSource: "recipe-total",
	showMarkCookedButton: true,
	markCookedAskDate: false,
	trackLastMade: true,
	lastMadeProperty: "lastMade",
	trackCookedCount: true,
	myAllergens: [],
	suggestionDayWindow: 14,
	suggestionCount: 5,
	diabeticMode: false,
	giDictionary: DEFAULT_GI_DICTIONARY,
	state: {
		oneOffs: [],
		checkedKeys: {},
		collapsedGroups: {},
	},
};

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
