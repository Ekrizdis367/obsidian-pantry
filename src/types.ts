export interface ParsedIngredient {
	/** Numeric quantity, if one was parsed. */
	quantity: number | null;
	/** Unit string as written, e.g. "cup", "tsp", "lb". Empty when unitless. */
	unit: string;
	/** Normalised ingredient name, lower-cased and trimmed. */
	name: string;
	/**
	 * Trailing parenthetical prep note, e.g. "softened" from
	 * `1 cup unsalted butter (softened)`. Null when absent. Kept for display
	 * (recipe view) but excluded from the name used for grocery consolidation.
	 */
	note: string | null;
	/** Trailing Obsidian-style tags found on the line (without the leading #). */
	tags: string[];
	/** Original raw line (without leading bullet markers). */
	raw: string;
}

export interface RecipeIngredient extends ParsedIngredient {
	/** Source recipe path for traceability. */
	sourcePath: string;
	/** Source recipe display name. */
	sourceName: string;
}

export interface OneOffItem {
	id: string;
	name: string;
	quantity: number | null;
	unit: string;
	category: string | null;
}

/** A named shop link on an inventory item (e.g. "Safeway" → product URL). */
export interface ShopLink {
	nickname: string;
	url: string;
}

/**
 * A single item in the user's pantry inventory.
 * Matched to grocery lines by normalised name when {@link inStock} is true.
 */
export interface InventoryItem {
	id: string;
	name: string;
	/**
	 * When true (default), matching grocery lines are omitted when
	 * "Exclude in-stock from grocery list" is enabled. Uncheck when you've
	 * run out so the next recipe pulls it back onto the list.
	 */
	inStock: boolean;
	unit: string;
	category: string | null;
	/** When the item was added to inventory (ISO timestamp). */
	dateAdded: string;
	/** User-supplied expiration date or notes. */
	expirationDate: string | null;
	/** Notes about the item (e.g., location in pantry). */
	notes: string | null;
	/** Free-form labels for grouping/filtering (e.g. "baking", "breakfast"). */
	tags: string[];
	/** Per-item shop links, capped at 4, each opened as-is (no URL rewriting). */
	shopLinks: ShopLink[];
}

/**
 * A single line in the grocery list, after consolidation.
 * Keyed uniquely by (name + unit).
 */
export interface GroceryItem {
	key: string;
	name: string;
	unit: string;
	quantity: number | null;
	category: string;
	/** Where the item came from. Recipes contribute display names; one-offs are flagged. */
	sources: GroceryItemSource[];
	/** Whether the user has checked this item off while shopping. */
	checked: boolean;
}

export interface GroceryItemSource {
	type: "recipe" | "one-off";
	label: string;
	/** Recipe file path, when type === "recipe". */
	path?: string;
}

export type GroupingMode = "category" | "recipe" | "none";

/**
 * Where a grocery item's category comes from.
 *   - "dictionary": built-in keyword dictionary (with user overrides applied first)
 *   - "tag":        the trailing #tag on the recipe line; falls back to "Other" when absent
 *   - "tag-then-dictionary": prefer the recipe's #tag, fall back to the dictionary
 */
export type CategorySource = "dictionary" | "tag" | "tag-then-dictionary";

export interface CategoryOverride {
	/** Lower-cased ingredient name (or substring) to match. */
	match: string;
	/** Category to assign when matched. */
	category: string;
}

/**
 * Nutrition totals for a recipe as written. All fields are optional
 * (null when the user hasn't filled them in).
 */
export interface RecipeNutrition {
	calories: number | null;
	protein: number | null;
	fat: number | null;
	carbs: number | null;
	fiber: number | null;
}
