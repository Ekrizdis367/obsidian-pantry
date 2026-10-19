import { ingredientKey } from "../parser/ingredient";
import { CheckedItemDisplay, PantrySettings } from "../settings";
import {
	GroceryItem,
	GroceryItemSource,
	OneOffItem,
	RecipeIngredient,
} from "../types";
import { categorize } from "./categorizer";

interface BuildOptions {
	recipeIngredients: RecipeIngredient[];
	oneOffs: OneOffItem[];
	settings: PantrySettings;
	checkedKeys: Record<string, boolean>;
}

/** Per-key bookkeeping for tags collected during aggregation. */
type ItemWithTags = GroceryItem & { _tags: string[] };

/**
 * Combine recipe ingredients and one-off items into a deduplicated grocery list.
 * Items are merged when their normalised name and unit match. Quantities are
 * summed when both sides have a quantity; otherwise the existing value wins
 * (so "2 cups flour" + "flour" becomes "2 cups flour" with multiple sources).
 */
export function buildGroceryList(opts: BuildOptions): GroceryItem[] {
	const map = new Map<string, ItemWithTags>();

	for (const ing of opts.recipeIngredients) {
		const key = ingredientKey(ing.name, ing.unit);
		mergeInto(map, key, {
			name: ing.name,
			unit: ing.unit,
			quantity: ing.quantity,
			tags: ing.tags,
			source: {
				type: "recipe",
				label: ing.sourceName,
				path: ing.sourcePath,
			},
		});
	}

	for (const item of opts.oneOffs) {
		const key = ingredientKey(item.name, item.unit);
		mergeInto(map, key, {
			name: item.name,
			unit: item.unit,
			quantity: item.quantity,
			tags: [],
			source: {
				type: "one-off",
				label: "Added manually",
			},
			categoryOverride: item.category ?? null,
		});
	}

	const result: GroceryItem[] = [];
	for (const item of map.values()) {
		const checked = opts.checkedKeys[item.key] === true;
		const category =
			item.category ||
			categorize(
				item.name,
				item._tags,
				opts.settings.categoryOverrides,
				opts.settings.categorySource,
			);
		result.push({
			key: item.key,
			name: item.name,
			unit: item.unit,
			quantity: item.quantity,
			sources: item.sources,
			category,
			checked,
		});
	}

	return result;
}

interface MergePayload {
	name: string;
	unit: string;
	quantity: number | null;
	tags: string[];
	source: GroceryItemSource;
	categoryOverride?: string | null;
}

function mergeInto(
	map: Map<string, ItemWithTags>,
	key: string,
	payload: MergePayload,
): void {
	const existing = map.get(key);
	if (!existing) {
		map.set(key, {
			key,
			name: payload.name,
			unit: payload.unit,
			quantity: payload.quantity,
			category: payload.categoryOverride ?? "",
			sources: [payload.source],
			checked: false,
			_tags: [...payload.tags],
		});
		return;
	}

	if (payload.quantity !== null) {
		existing.quantity =
			existing.quantity === null
				? payload.quantity
				: existing.quantity + payload.quantity;
	}

	if (payload.categoryOverride && !existing.category) {
		existing.category = payload.categoryOverride;
	}

	if (
		!existing.sources.some(
			(s) => s.type === payload.source.type && s.label === payload.source.label,
		)
	) {
		existing.sources.push(payload.source);
	}

	for (const tag of payload.tags) existing._tags.push(tag);
}

/**
 * Group items for display.
 *
 * Returns an ordered list of [groupName, items] pairs. Items inside each group
 * are sorted alphabetically by name.
 */
export function groupForDisplay(
	items: GroceryItem[],
	settings: PantrySettings,
): Array<[string, GroceryItem[]]> {
	const grouping = settings.grouping;
	const sortedItems = [...items].sort((a, b) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
	);

	if (grouping === "none") {
		return [["All items", sortedItems]];
	}

	if (grouping === "recipe") {
		const groups = new Map<string, GroceryItem[]>();
		for (const item of sortedItems) {
			const labels = item.sources.map((s) =>
				s.type === "recipe" ? s.label : "One-off items",
			);
			const seen = new Set<string>();
			for (const label of labels) {
				if (seen.has(label)) continue;
				seen.add(label);
				pushTo(groups, label, item);
			}
		}
		return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
	}

	// Default: category grouping.
	const groups = new Map<string, GroceryItem[]>();
	for (const item of sortedItems) {
		pushTo(groups, item.category || "Other", item);
	}

	const order = settings.categoryOrder.length
		? settings.categoryOrder
		: [];
	const orderedKeys: string[] = [];
	for (const key of order) {
		if (groups.has(key)) orderedKeys.push(key);
	}
	const remaining = [...groups.keys()]
		.filter((k) => !orderedKeys.includes(k))
		.sort();
	const finalKeys = [...orderedKeys, ...remaining];
	return finalKeys.map((k) => [k, groups.get(k) ?? []]);
}

function pushTo(map: Map<string, GroceryItem[]>, key: string, item: GroceryItem) {
	const arr = map.get(key);
	if (arr) arr.push(item);
	else map.set(key, [item]);
}

/**
 * Arrange items within a grocery section according to the checked-item
 * display setting. Applied at render time (not in {@link groupForDisplay})
 * so auto-collapse and export still see every item.
 */
export function arrangeCheckedItems(
	items: GroceryItem[],
	mode: CheckedItemDisplay,
): GroceryItem[] {
	if (mode === "inline") return items;
	if (mode === "hidden") return items.filter((item) => !item.checked);
	const unchecked = items.filter((item) => !item.checked);
	const checked = items.filter((item) => item.checked);
	return [...unchecked, ...checked];
}
