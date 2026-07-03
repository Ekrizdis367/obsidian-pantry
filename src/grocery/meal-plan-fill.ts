import { App, TFile, TFolder } from "obsidian";
import { GroceryListManager } from "./manager";
import { listRecipeLibrary, RecipeEntry } from "./library";
import {
	emptyGrid,
	MealPlanGrid,
	occurrencesToGrid,
	parseMealPlanContents,
	serializeMealPlanGrid,
} from "../parser/meal-plan";
import {
	activeMealDays,
	activeMealSlots,
	PantrySettings,
} from "../settings";

export interface AutoFillResult {
	/** Empty slots that received a recipe. */
	filled: number;
	/** Empty slots with no matching candidates. */
	skipped: number;
	/** Slots that already had at least one recipe (left untouched). */
	unchanged: number;
}

interface WeightedCandidate {
	file: TFile;
	weight: number;
}

/**
 * Fill only empty planner cells from the recipe library. Slots that already
 * contain a recipe are never modified, so manual picks stay intact. An
 * entirely empty grid is filled end-to-end.
 */
export function autoFillEmptySlots(
	app: App,
	settings: PantrySettings,
	grid: MealPlanGrid,
): AutoFillResult {
	const library = listRecipeLibrary(app, settings);
	const allowed = parseStatusValues(settings.autoFillStatusValues);
	const maxStatus = allowed.length > 0 ? Math.max(...allowed) : 0;

	let filled = 0;
	let skipped = 0;
	let unchanged = 0;

	for (const day of grid.days) {
		for (const slot of grid.slots) {
			const cell = grid.cells[day]?.[slot];
			if (!cell) continue;
			if (cell.length > 0) {
				unchanged++;
				continue;
			}

			const pick = pickForSlot(
				app,
				settings,
				library,
				slot,
				allowed,
				maxStatus,
			);
			if (!pick) {
				skipped++;
				continue;
			}

			cell.push(pick);
			filled++;
		}
	}

	return { filled, skipped, unchanged };
}

/** Load the current meal-plan note into a grid (empty grid when unset/missing). */
export async function loadMealPlanGrid(
	app: App,
	settings: PantrySettings,
): Promise<MealPlanGrid> {
	const days = activeMealDays(settings);
	const slots = activeMealSlots(settings);
	const path = settings.mealPlanNotePath.trim();
	if (!path) return emptyGrid(days, slots);

	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return emptyGrid(days, slots);

	try {
		const contents = await app.vault.cachedRead(file);
		const { occurrences } = parseMealPlanContents(
			app,
			file.path,
			contents,
			settings,
		);
		return occurrencesToGrid(occurrences, days, slots);
	} catch (err) {
		console.error("pantry: failed to load meal plan for auto-fill", err);
		return emptyGrid(days, slots);
	}
}

export interface MealPlanPersistDeps {
	getSettings: () => PantrySettings;
	saveSettings: () => Promise<void>;
	manager: GroceryListManager;
}

/** Write a grid to the plan note and refresh the grocery list when auto-sync is on. */
export async function saveMealPlanGrid(
	app: App,
	grid: MealPlanGrid,
	deps: MealPlanPersistDeps,
): Promise<TFile> {
	const settings = deps.getSettings();
	const file = await ensurePlanFile(app, grid, deps);
	const contents = serializeMealPlanGrid(
		app,
		file.path,
		grid,
		file.basename,
	);
	await app.vault.modify(file, contents);
	if (settings.mealPlanEnabled) {
		await deps.manager.refresh();
	}
	return file;
}

/** Load, fill empty slots, save, and return counts for a Notice. */
export async function runAutoFillWeek(
	app: App,
	deps: MealPlanPersistDeps,
): Promise<AutoFillResult> {
	const settings = deps.getSettings();
	const grid = await loadMealPlanGrid(app, settings);
	const result = autoFillEmptySlots(app, settings, grid);
	if (result.filled > 0) {
		await saveMealPlanGrid(app, grid, deps);
	}
	return result;
}

function pickForSlot(
	app: App,
	settings: PantrySettings,
	library: readonly RecipeEntry[],
	slot: string,
	allowed: readonly number[],
	maxStatus: number,
): TFile | null {
	const candidates: WeightedCandidate[] = [];

	for (const entry of library) {
		const cache = app.metadataCache.getFileCache(entry.file);
		const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
		const status = readNumericFrontmatter(
			fm,
			settings.autoFillStatusProperty,
		);
		if (status === null || !allowed.includes(status)) continue;

		const meals = readMealTags(fm, settings.autoFillMealProperty);
		if (!mealMatchesSlot(meals, slot)) continue;

		const weight = maxStatus + 1 - status;
		if (weight <= 0) continue;
		candidates.push({ file: entry.file, weight });
	}

	return weightedPick(candidates);
}

function parseStatusValues(raw: readonly number[]): number[] {
	return [...raw]
		.filter((n) => Number.isFinite(n))
		.sort((a, b) => a - b);
}

function readNumericFrontmatter(
	fm: Record<string, unknown>,
	property: string,
): number | null {
	const key = property.trim();
	if (!key) return null;
	const raw = fm[key];
	if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	if (typeof raw === "string") {
		const n = Number(raw.trim());
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

function readMealTags(
	fm: Record<string, unknown>,
	property: string,
): string[] {
	const key = property.trim();
	if (!key) return [];
	const raw = fm[key];
	if (Array.isArray(raw)) {
		return raw
			.filter((v): v is string => typeof v === "string")
			.map((v) => v.trim().toLowerCase())
			.filter(Boolean);
	}
	if (typeof raw === "string") {
		const trimmed = raw.trim().toLowerCase();
		return trimmed ? [trimmed] : [];
	}
	return [];
}

/** When `meal` is absent, treat the recipe as eligible for any slot. */
function mealMatchesSlot(meals: readonly string[], slot: string): boolean {
	if (meals.length === 0) return true;
	const slotLower = slot.trim().toLowerCase();
	return meals.some((meal) => {
		if (meal === slotLower) return true;
		if (slotLower === "snacks" && (meal === "snack" || meal === "snacks")) {
			return true;
		}
		return false;
	});
}

function weightedPick(candidates: readonly WeightedCandidate[]): TFile | null {
	if (candidates.length === 0) return null;
	let total = 0;
	for (const c of candidates) total += c.weight;
	if (total <= 0) return null;

	let roll = Math.random() * total;
	for (const c of candidates) {
		roll -= c.weight;
		if (roll <= 0) return c.file;
	}
	return candidates[candidates.length - 1]?.file ?? null;
}

async function ensurePlanFile(
	app: App,
	grid: MealPlanGrid,
	deps: MealPlanPersistDeps,
): Promise<TFile> {
	const settings = deps.getSettings();
	let path = settings.mealPlanNotePath.trim();
	if (!path) {
		path = "meal-plan.md";
		settings.mealPlanNotePath = path;
		await deps.saveSettings();
	}

	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;

	await ensureParentFolder(app, path);
	const initial = serializeMealPlanGrid(
		app,
		path,
		grid,
		basenameFromPath(path),
	);
	return app.vault.create(path, initial);
}

async function ensureParentFolder(app: App, path: string): Promise<void> {
	const slash = path.lastIndexOf("/");
	if (slash === -1) return;
	const dir = path.slice(0, slash);
	if (!dir) return;
	const existing = app.vault.getAbstractFileByPath(dir);
	if (existing instanceof TFolder) return;
	try {
		await app.vault.createFolder(dir);
	} catch {
		// Folder may already exist or be created concurrently; ignore.
	}
}

function basenameFromPath(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return name.endsWith(".md") ? name.slice(0, -3) : name;
}

/** User-facing summary after an auto-fill run. */
export function formatAutoFillNotice(result: AutoFillResult): string {
	if (result.filled === 0 && result.unchanged > 0 && result.skipped === 0) {
		return "Every slot already has a recipe — nothing to fill.";
	}
	if (result.filled === 0) {
		const hint =
			result.skipped > 0
				? " Check your status and meal frontmatter, or widen the allowed status values in settings."
				: "";
		return `No empty slots could be filled.${hint}`;
	}
	const parts = [
		`Filled ${result.filled} empty slot${result.filled === 1 ? "" : "s"}`,
	];
	if (result.skipped > 0) {
		parts.push(
			`${result.skipped} skipped (no matching recipe${result.skipped === 1 ? "" : "s"})`,
		);
	}
	return `${parts.join(" · ")}.`;
}

/** Parse a comma-separated list of integers from settings text input. */
export function parseStatusValuesInput(input: string): number[] {
	const out: number[] = [];
	for (const part of input.split(",")) {
		const n = Number(part.trim());
		if (Number.isFinite(n)) out.push(Math.round(n));
	}
	return [...new Set(out)].sort((a, b) => a - b);
}

/** Format status values for display in a settings text field. */
export function formatStatusValuesInput(values: readonly number[]): string {
	return values.join(", ");
}
