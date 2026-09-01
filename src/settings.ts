import { DEFAULT_GI_DICTIONARY } from "./parser/glycemic";
import {
	CategoryOverride,
	CategorySource,
	GroupingMode,
	InventoryItem,
	OneOffItem,
} from "./types";

/** Default vault-relative path for cross-device shopping list state. */
export const DEFAULT_SHOPPING_STATE_PATH = "Pantry/shopping-state.json";

/** Default vault-relative path for cross-device inventory state. */
export const DEFAULT_INVENTORY_STATE_PATH = "Pantry/inventory-state.json";

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
	/** Which meal slots appear in the planner grid (subset of Breakfast/Lunch/Dinner/Snacks). */
	mealPlanSlots: string[];
	/** Whether the planner includes Saturday and Sunday in addition to the weekdays. */
	mealPlanIncludeWeekend: boolean;
	/** Frontmatter property read when auto-filling empty planner slots (default: status). */
	autoFillStatusProperty: string;
	/** Allowed numeric status values for auto-fill, lower numbers weighted more heavily. */
	autoFillStatusValues: number[];
	/** Frontmatter property listing which meals a recipe suits (default: meal). */
	autoFillMealProperty: string;
	/** Default vault-relative folder for recipes imported from a URL. Empty = first recipe folder. */
	importFolder: string;
	/** Optional vault note used as the import template. Empty = built-in Pantry template. */
	importTemplatePath: string;
	/**
	 * Vault-relative JSON file for one-offs, checks, and collapsed sections.
	 * Lives in the vault (not plugin data.json) so Obsidian Sync / folder sync
	 * keeps shopping list state in sync across devices.
	 */
	shoppingStatePath: string;
	/**
	 * In-memory shopping list runtime state. Persisted to {@link shoppingStatePath}
	 * in the vault — not to plugin data.json.
	 */
	state: PantrySavedState;
	/**
	 * Vault-relative JSON file for pantry inventory items.
	 * Lives in the vault so Obsidian Sync / folder sync keeps inventory
	 * in sync across devices.
	 */
	inventoryStatePath: string;
	/**
	 * In-memory inventory runtime state. Persisted to {@link inventoryStatePath}
	 * in the vault — not to plugin data.json.
	 */
	inventoryState: PantrySavedInventoryState;
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

export interface PantrySavedInventoryState {
	/** Items in the user's pantry inventory. */
	items: InventoryItem[];
	/**
	 * Map from category name to whether the user has it collapsed.
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

/** Default status values eligible for meal-planner auto-fill (1 = highest priority). */
export const DEFAULT_AUTO_FILL_STATUS_VALUES = [1, 2, 3, 4, 5] as const;

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

/** All meal slots Pantry understands (display order). */
export const MEAL_PLAN_SLOTS = [
	"Breakfast",
	"Lunch",
	"Dinner",
	"Snacks",
] as const;

/** Default slot selection for new installs (breakfast, lunch, dinner). */
export const DEFAULT_MEAL_PLAN_SLOT_SELECTION = [
	"Breakfast",
	"Lunch",
	"Dinner",
] as const;

/** Marker comment written at the top of planner-managed meal-plan notes. */
export const MEAL_PLAN_MARKER = "<!-- pantry:meal-plan -->";

/**
 * Normalize a user-provided slot list to canonical names in display order.
 * Falls back to {@link DEFAULT_MEAL_PLAN_SLOT_SELECTION} when nothing valid remains.
 */
export function normalizeMealPlanSlots(input: readonly string[]): string[] {
	if (input.length === 0) return [...DEFAULT_MEAL_PLAN_SLOT_SELECTION];
	const wanted = new Set(
		input.map((s) => s.trim().toLowerCase()).filter(Boolean),
	);
	const out = MEAL_PLAN_SLOTS.filter((slot) =>
		wanted.has(slot.toLowerCase()),
	);
	return out.length > 0 ? [...out] : [...DEFAULT_MEAL_PLAN_SLOT_SELECTION];
}

/** Slots active in the planner, in canonical order. */
export function activeMealSlots(settings: PantrySettings): string[] {
	return normalizeMealPlanSlots(settings.mealPlanSlots);
}

/** Whether a canonical slot name is enabled in the planner. */
export function isMealPlanSlotEnabled(
	settings: PantrySettings,
	slot: string,
): boolean {
	return activeMealSlots(settings).some(
		(s) => s.toLowerCase() === slot.toLowerCase(),
	);
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
	mealPlanSlots: [...DEFAULT_MEAL_PLAN_SLOT_SELECTION],
	mealPlanIncludeWeekend: false,
	autoFillStatusProperty: "status",
	autoFillStatusValues: [...DEFAULT_AUTO_FILL_STATUS_VALUES],
	autoFillMealProperty: "meal",
	importFolder: "",
	importTemplatePath: "",
	shoppingStatePath: DEFAULT_SHOPPING_STATE_PATH,
	state: {
		oneOffs: [],
		checkedKeys: {},
		collapsedGroups: {},
	},
	inventoryStatePath: DEFAULT_INVENTORY_STATE_PATH,
	inventoryState: {
		items: [],
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
	kidsApproved: "kidsApproved",
	cookedCount: "cookedCount",
} as const;
