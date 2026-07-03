import { App, TFile } from "obsidian";
import {
	formatLocalISO,
	readCookedCount,
	readLastMade,
} from "../parser/recipe-meta";
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
			const today = formatLocalISO(new Date());
			const previous = readLastMade(fm, key);
			fm[key] = today;

			if (settings.trackCookedCount && previous !== today) {
				const current = readCookedCount(fm);
				fm[RECIPE_FRONTMATTER.cookedCount] = current + 1;
			}
		},
	);
}
