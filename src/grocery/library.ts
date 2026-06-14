import { App, TFile } from "obsidian";
import {
	fileInRecipeFolders,
	isRecipeSelected,
	recipeTypeMatches,
} from "../parser/recipe";
import { listMarkdownFilesInRecipeFolders } from "../utils/vault-files";
import {
	daysSince,
	matchingAllergens,
	readRecipeMeta,
	RecipeMeta,
} from "../parser/recipe-meta";
import { PantrySettings } from "../settings";

/** A recipe file paired with its parsed Pantry metadata. */
export interface RecipeEntry {
	file: TFile;
	meta: RecipeMeta;
	selected: boolean;
}

/**
 * Walk the vault and return every markdown file whose `type` frontmatter
 * matches the user's configured recipe type AND that lives in one of the
 * configured recipe folders. This is the canonical "recipe library" the
 * recommender and leaderboard operate on.
 */
export function listRecipeLibrary(
	app: App,
	settings: PantrySettings,
): RecipeEntry[] {
	const target = settings.recipeTypeValue.trim() || "recipe";
	const property = settings.recipeTypeProperty.trim() || "type";
	const out: RecipeEntry[] = [];
	for (const file of listMarkdownFilesInRecipeFolders(app, settings)) {
		if (!fileInRecipeFolders(file, settings.recipeFolders)) continue;
		const cache = app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
		if (!recipeTypeMatches(fm[property], target)) continue;
		out.push({
			file,
			meta: readRecipeMeta(cache, settings.lastMadeProperty),
			selected: isRecipeSelected(cache, settings.selectionProperty),
		});
	}
	return out;
}

export interface SuggestionFilters {
	favoritesOnly: boolean;
	hideAllergens: boolean;
}

/**
 * Pick `count` recipes the user hasn't cooked recently, optionally
 * filtered to favorites and/or excluding allergen matches. Currently
 * selected recipes are always excluded so we don't suggest something
 * already on this week's list.
 *
 * Selection is shuffled so re-running the command surfaces different
 * options - it's a recommender, not a deterministic ranking.
 */
export function suggestMeals(
	library: readonly RecipeEntry[],
	settings: PantrySettings,
	filters: SuggestionFilters,
	count: number,
): RecipeEntry[] {
	const window = settings.suggestionDayWindow;
	const filtered = library.filter((entry) => {
		if (entry.selected) return false;
		if (filters.favoritesOnly && !entry.meta.favorite) return false;
		if (
			filters.hideAllergens &&
			matchingAllergens(entry.meta.allergens, settings.myAllergens).length > 0
		) {
			return false;
		}
		if (window > 0) {
			const days = daysSince(entry.meta.lastMade);
			if (days !== null && days < window) return false;
		}
		return true;
	});
	return shuffle(filtered).slice(0, Math.max(1, count));
}

/**
 * Sort recipes by cooked count (descending), then most recently made
 * (descending), then by basename. Recipes with zero cooks fall to the
 * bottom but are still returned so users with few cooks can see their
 * whole library.
 */
export function leaderboard(library: readonly RecipeEntry[]): RecipeEntry[] {
	return [...library].sort((a, b) => {
		const countDiff = b.meta.cookedCount - a.meta.cookedCount;
		if (countDiff !== 0) return countDiff;
		const aDate = a.meta.lastMade ?? "";
		const bDate = b.meta.lastMade ?? "";
		if (aDate !== bDate) return bDate.localeCompare(aDate);
		return a.file.basename.localeCompare(b.file.basename);
	});
}

/** Fisher-Yates shuffle returning a new array. */
function shuffle<T>(arr: readonly T[]): T[] {
	const out = [...arr];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = out[i] as T;
		out[i] = out[j] as T;
		out[j] = tmp;
	}
	return out;
}
