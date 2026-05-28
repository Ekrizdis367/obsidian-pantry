import { App, TFile } from "obsidian";
import { readCookedCount, readLastMade } from "../parser/recipe-meta";
import { PantrySettings, RECIPE_FRONTMATTER } from "../settings";

/**
 * Toggles a recipe's selection flag in its frontmatter and, when the
 * recipe is being added to the list and the feature is enabled, stamps
 * the configured "last made" property with today's date and bumps the
 * cooked counter (only when today is a different day than the previous
 * stamp, so toggling on/off in the same day doesn't inflate the count).
 *
 * Removing a recipe from the list never touches the date or the count
 * so the historical record survives unchecking.
 */
export async function setRecipeSelection(
	app: App,
	file: TFile,
	selected: boolean,
	settings: PantrySettings,
): Promise<void> {
	await app.fileManager.processFrontMatter(
		file,
		(fm: Record<string, unknown>) => {
			fm[settings.selectionProperty] = selected;
			if (!selected) return;
			if (!settings.trackLastMade) return;

			const key = settings.lastMadeProperty.trim() || "lastMade";
			const today = todayLocalISO();
			const previous = readLastMade(fm, key);
			fm[key] = today;

			if (settings.trackCookedCount && previous !== today) {
				const current = readCookedCount(fm);
				fm[RECIPE_FRONTMATTER.cookedCount] = current + 1;
			}
		},
	);
}

/** YYYY-MM-DD in the user's local time (so a late-night cook still says "today"). */
function todayLocalISO(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/**
 * Stamps a recipe's "last made" date to the given date string and, when
 * `trackCookedCount` is enabled and the date differs from the previous
 * value, increments `cookedCount`. Does not touch the selection property.
 *
 * Returns the new cooked count when it was incremented, otherwise null.
 */
export async function stampRecipeCooked(
	app: App,
	file: TFile,
	date: string,
	settings: PantrySettings,
): Promise<{ newCount: number | null }> {
	if (!settings.trackLastMade) return { newCount: null };
	let newCount: number | null = null;
	await app.fileManager.processFrontMatter(
		file,
		(fm: Record<string, unknown>) => {
			const key = settings.lastMadeProperty.trim() || "lastMade";
			const previous = readLastMade(fm, key);
			fm[key] = date;

			if (settings.trackCookedCount && previous !== date) {
				const current = readCookedCount(fm);
				newCount = current + 1;
				fm[RECIPE_FRONTMATTER.cookedCount] = newCount;
			}
		},
	);
	return { newCount };
}
