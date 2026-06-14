import { App, TFile } from "obsidian";
import { formatLocalISO } from "../parser/recipe-meta";
import { PantrySettings } from "../settings";
import {
	DEFAULT_RECIPE_NOTE_TEMPLATE,
} from "./default-template";
import { ImportedRecipe } from "./types";

/**
 * Build a normalized Pantry recipe note from extracted web data.
 *
 * Uses the built-in template unless the user configured a custom vault note
 * at `settings.importTemplatePath`.
 */
export async function buildRecipeNote(
	app: App,
	recipe: ImportedRecipe,
	settings: PantrySettings,
): Promise<string> {
	const template = await loadTemplate(app, settings.importTemplatePath);
	const tokens = buildTemplateTokens(recipe, settings);
	return renderTemplate(template, tokens);
}

async function loadTemplate(
	app: App,
	templatePath: string,
): Promise<string> {
	const trimmed = templatePath.trim();
	if (!trimmed) return DEFAULT_RECIPE_NOTE_TEMPLATE;

	const file = app.vault.getAbstractFileByPath(trimmed);
	if (file instanceof TFile) {
		return await app.vault.read(file);
	}
	return DEFAULT_RECIPE_NOTE_TEMPLATE;
}

function buildTemplateTokens(
	recipe: ImportedRecipe,
	settings: PantrySettings,
): Record<string, string> {
	const servings = parseServingCount(recipe.servings);

	return {
		title: recipe.title,
		recipeTypeProperty: settings.recipeTypeProperty.trim() || "type",
		recipeTypeValue: settings.recipeTypeValue.trim() || "recipe",
		category: "",
		source: yamlQuote(recipe.sourceUrl),
		image: yamlQuote(recipe.image),
		selectionProperty: settings.selectionProperty.trim() || "groceryList",
		lastMadeProperty: settings.lastMadeProperty.trim() || "lastMade",
		servings: servings !== null ? String(servings) : "",
		calories: formatOptionalNumber(recipe.calories),
		protein: formatOptionalNumber(recipe.protein),
		fat: formatOptionalNumber(recipe.fat),
		carbs: formatOptionalNumber(recipe.carbs),
		prepTime: formatOptionalNumber(recipe.prepTime),
		cookTime: formatOptionalNumber(recipe.cookTime),
		totalTime: formatOptionalNumber(recipe.totalTime),
		description: recipe.description.trim(),
		ingredientsHeading: settings.ingredientsHeading.trim() || "Ingredients",
		instructionsHeading:
			settings.instructionsHeading.trim() || "Instructions",
		ingredients: formatIngredientLines(recipe.ingredientLines),
		instructions: formatInstructionSteps(recipe.instructionSteps),
		date: formatLocalISO(new Date()),
	};
}

function renderTemplate(
	template: string,
	tokens: Record<string, string>,
): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => tokens[key] ?? "");
}

function formatIngredientLines(lines: readonly string[]): string {
	if (lines.length === 0) return "";
	return lines
		.map((line) => {
			const trimmed = line.trim();
			if (!trimmed) return "";
			if (/^[-*+]\s+/.test(trimmed)) return trimmed;
			return `- ${trimmed}`;
		})
		.filter(Boolean)
		.join("\n");
}

function formatInstructionSteps(steps: readonly string[]): string {
	if (steps.length === 0) return "";
	let stepNumber = 0;
	return steps
		.map((step) => {
			const trimmed = step.trim();
			if (!trimmed) return "";
			if (/^\*\*.+\*\*$/.test(trimmed)) return trimmed;
			if (/^\d+\.\s+/.test(trimmed)) return trimmed;
			stepNumber += 1;
			return `${stepNumber}. ${trimmed}`;
		})
		.filter(Boolean)
		.join("\n");
}

function formatOptionalNumber(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return "";
	return String(Math.round(value));
}

function parseServingCount(yields: string): number | null {
	const match = yields.match(/(\d+(?:\.\d+)?)/);
	if (!match) return null;
	const n = Number(match[1]);
	return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function yamlQuote(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	if (/^[a-z][\w-]*$/i.test(trimmed) && !trimmed.includes(":")) {
		return trimmed;
	}
	return `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Derive a safe vault filename from a recipe title. */
export function titleToFilename(title: string): string {
	return (
		title
			.trim()
			.replace(/[\\/:*?"<>|#^[\]]/g, "")
			.replace(/\s+/g, " ")
			.trim() || "Imported Recipe"
	);
}

/** Default folder for imported recipes: explicit setting, else first recipe folder. */
export function defaultImportFolder(settings: PantrySettings): string {
	if (settings.importFolder.trim()) return settings.importFolder.trim();
	return settings.recipeFolders[0]?.trim() ?? "";
}

export async function ensureParentFolders(
	app: App,
	filePath: string,
): Promise<void> {
	const parts = filePath.split("/");
	parts.pop();
	let current = "";
	for (const part of parts) {
		if (!part) continue;
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}
