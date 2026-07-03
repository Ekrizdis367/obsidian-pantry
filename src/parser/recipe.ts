import { App, CachedMetadata, TFile } from "obsidian";
import { PantrySettings, RECIPE_FRONTMATTER } from "../settings";
import { listMarkdownFilesInRecipeFolders } from "../utils/vault-files";
import { RecipeIngredient } from "../types";
import { regexCapture, stripWikiLink, trimEndText, trimText } from "../utils/text";
import { hasIgnoreTag, parseIngredientLine } from "./ingredient";

/**
 * Does a note's recipe-type frontmatter value match the configured target?
 *
 * Matching is case-insensitive and tolerant of how Obsidian stores the value:
 * a plain string, a wikilink (`[[Recipes]]`), or a list mixing either. Each
 * candidate is unwrapped via {@link stripWikiLink} before comparison so a note
 * with `type: [[Recipes]]` matches a configured value of `Recipes`.
 */
export function recipeTypeMatches(fmValue: unknown, target: string): boolean {
	const wanted = target.trim().toLowerCase();
	if (!wanted) return false;

	const candidates: string[] = [];
	if (typeof fmValue === "string") {
		candidates.push(fmValue);
	} else if (Array.isArray(fmValue)) {
		for (const entry of fmValue) {
			if (typeof entry === "string") candidates.push(entry);
		}
	}

	return candidates.some(
		(candidate) => stripWikiLink(candidate).toLowerCase() === wanted,
	);
}

/** Returns true if the file lives inside one of the configured folders (or all are empty). */
export function fileInRecipeFolders(file: TFile, folders: string[]): boolean {
	if (folders.length === 0) return true;
	return folders.some((folder) => {
		const f = folder.replace(/\/+$/, "");
		if (!f) return true;
		return file.path === f || file.path.startsWith(`${f}/`);
	});
}

/**
 * Reads the boolean selection flag from a recipe's frontmatter.
 * Accepts true/"true"/"yes"/1 as truthy.
 */
export function isRecipeSelected(
	cache: CachedMetadata | null,
	property: string,
): boolean {
	const fm = cache?.frontmatter;
	if (!fm) return false;
	const value: unknown = fm[property];
	if (value === undefined || value === null) return false;
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") {
		const v = value.trim().toLowerCase();
		return v === "true" || v === "yes" || v === "1";
	}
	return false;
}

/** Find all markdown files in the configured recipe folders that are flagged for the week. */
export function findSelectedRecipes(
	app: App,
	settings: PantrySettings,
): TFile[] {
	const selected: TFile[] = [];
	for (const file of listMarkdownFilesInRecipeFolders(app, settings)) {
		if (!fileInRecipeFolders(file, settings.recipeFolders)) continue;
		const cache = app.metadataCache.getFileCache(file);
		if (isRecipeSelected(cache, settings.selectionProperty)) {
			selected.push(file);
		}
	}
	return selected;
}

/**
 * Extract ingredient lines from a recipe file's body.
 *
 * Looks for the first heading whose plain text matches `ingredientsHeading`
 * (case-insensitive). Ingredients are list items appearing between that
 * heading and the next heading of equal or higher level.
 *
 * If no matching heading is found, every list item in the document is
 * treated as an ingredient (useful for very short recipes).
 */
export function extractIngredientLines(
	body: string,
	headingName: string,
): string[] {
	const lines = body.split(/\r?\n/);
	const headingPattern = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
	const target = headingName.trim().toLowerCase();

	let startIndex = -1;
	let startLevel = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const match = line.match(headingPattern);
		if (!match) continue;
		const level = (match[1] ?? "").length;
		const title = (match[2] ?? "").trim().toLowerCase();
		if (title === target) {
			startIndex = i + 1;
			startLevel = level;
			break;
		}
	}

	const collected: string[] = [];
	if (startIndex === -1) {
		// Fallback: collect every list item in the file.
		for (const line of lines) {
			if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
				collected.push(line);
			}
		}
		return collected;
	}

	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const heading = line.match(headingPattern);
		if (heading && (heading[1] ?? "").length <= startLevel) break;
		if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
			collected.push(line);
		}
	}
	return collected;
}

/**
 * Read a recipe file from disk, extract its ingredients section, and
 * parse each entry into a RecipeIngredient.
 *
 * Quantities are scaled by the recipe's `multiplier` frontmatter value
 * (default 1) so the grocery list reflects the desired portion size.
 */
export async function parseRecipeFile(
	app: App,
	file: TFile,
	settings: PantrySettings,
): Promise<RecipeIngredient[]> {
	const contents = await app.vault.cachedRead(file);
	const body = stripFrontmatter(contents);
	const rawLines = extractIngredientLines(body, settings.ingredientsHeading);

	const cache = app.metadataCache.getFileCache(file);
	const multiplier = readRecipeMultiplier(cache);

	const result: RecipeIngredient[] = [];
	for (const raw of rawLines) {
		const parsed = parseIngredientLine(raw);
		if (!parsed) continue;
		if (hasIgnoreTag(parsed.tags)) continue;
		result.push({
			...parsed,
			quantity:
				parsed.quantity === null ? null : parsed.quantity * multiplier,
			sourcePath: file.path,
			sourceName: file.basename,
		});
	}
	return result;
}

/**
 * Read the `multiplier` frontmatter value as a positive number.
 * Returns 1 when missing, zero, negative, or unparseable.
 */
export function readRecipeMultiplier(cache: CachedMetadata | null): number {
	const fm = cache?.frontmatter;
	if (!fm) return 1;
	const raw: unknown = fm[RECIPE_FRONTMATTER.multiplier];
	if (raw === undefined || raw === null) return 1;
	const num = typeof raw === "number" ? raw : Number(raw);
	if (!Number.isFinite(num) || num <= 0) return 1;
	return num;
}

/** Strip a leading YAML frontmatter block, if present. */
export function stripFrontmatter(contents: string): string {
	if (!contents.startsWith("---")) return contents;
	const end = contents.indexOf("\n---", 3);
	if (end === -1) return contents;
	const after = contents.indexOf("\n", end + 4);
	if (after === -1) return "";
	return contents.slice(after + 1);
}

/**
 * Split a recipe body into the markdown that comes before the
 * ingredients section, the raw ingredient lines, and the markdown that
 * comes after. Used by the recipe view to render the surrounding
 * markdown verbatim while replacing the ingredients section with an
 * interactive, multiplier-aware display.
 *
 * If no ingredients heading is found, the entire body is returned in
 * `before` so the recipe view can render it as-is and the multiplier
 * controls still appear (just without scaled quantities).
 */
export function splitBodyAroundIngredients(
	body: string,
	headingName: string,
): { before: string; ingredientLines: string[]; after: string } {
	const lines = body.split(/\r?\n/);
	const headingPattern = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
	const target = headingName.trim().toLowerCase();

	let headingIndex = -1;
	let headingLevel = 0;
	for (let i = 0; i < lines.length; i++) {
		const match = (lines[i] ?? "").match(headingPattern);
		if (!match) continue;
		const level = regexCapture(match, 1).length;
		const title = regexCapture(match, 2).trim().toLowerCase();
		if (title === target) {
			headingIndex = i;
			headingLevel = level;
			break;
		}
	}

	if (headingIndex === -1) {
		return { before: body, ingredientLines: [], after: "" };
	}

	const ingredientLines: string[] = [];
	let endIndex = lines.length;
	for (let i = headingIndex + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const heading = line.match(headingPattern);
		if (heading && regexCapture(heading, 1).length <= headingLevel) {
			endIndex = i;
			break;
		}
		if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
			ingredientLines.push(line);
		}
	}

	const before = trimEndText(lines.slice(0, headingIndex).join("\n"));
	const after = trimText(lines.slice(endIndex).join("\n"));
	return { before, ingredientLines, after };
}

/**
 * Split an arbitrary block of markdown into the part before the
 * instructions heading, an array of step strings, and the part after
 * the instructions section. Returns `steps: []` when no heading or no
 * list items are found, and the original input in `before`.
 *
 * Each step string is the raw markdown of that step's body, with any
 * leading list marker removed. Continuation lines (everything between
 * one list marker and the next) are kept so that multi-line steps and
 * sub-bullets render correctly.
 */
export function splitBodyAroundInstructions(
	body: string,
	headingName: string,
): { before: string; steps: string[]; after: string } {
	const lines = body.split(/\r?\n/);
	const headingPattern = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
	const target = headingName.trim().toLowerCase();

	let headingIndex = -1;
	let headingLevel = 0;
	for (let i = 0; i < lines.length; i++) {
		const match = (lines[i] ?? "").match(headingPattern);
		if (!match) continue;
		const level = regexCapture(match, 1).length;
		const title = regexCapture(match, 2).trim().toLowerCase();
		if (title === target) {
			headingIndex = i;
			headingLevel = level;
			break;
		}
	}

	if (headingIndex === -1) {
		return { before: body, steps: [], after: "" };
	}

	let endIndex = lines.length;
	for (let i = headingIndex + 1; i < lines.length; i++) {
		const heading = (lines[i] ?? "").match(headingPattern);
		if (heading && regexCapture(heading, 1).length <= headingLevel) {
			endIndex = i;
			break;
		}
	}

	const sectionLines = lines.slice(headingIndex + 1, endIndex);
	const steps = parseInstructionSteps(sectionLines);

	const before = trimEndText(lines.slice(0, headingIndex).join("\n"));
	const after = trimText(lines.slice(endIndex).join("\n"));
	return { before, steps, after };
}

function parseInstructionSteps(sectionLines: string[]): string[] {
	const orderedRe = /^\s*\d+\.\s+(.*)$/;
	const unorderedRe = /^\s*[-*+]\s+(.*)$/;

	const startsForPattern = (re: RegExp): { idx: number; first: string }[] => {
		const out: { idx: number; first: string }[] = [];
		for (let i = 0; i < sectionLines.length; i++) {
			const m = (sectionLines[i] ?? "").match(re);
			if (m) out.push({ idx: i, first: regexCapture(m, 1) });
		}
		return out;
	};

	let starts = startsForPattern(orderedRe);
	if (starts.length === 0) {
		starts = startsForPattern(unorderedRe);
	}
	if (starts.length === 0) return [];

	const steps: string[] = [];
	for (let i = 0; i < starts.length; i++) {
		const start = starts[i]!;
		const next = starts[i + 1]?.idx ?? sectionLines.length;
		const parts = [start.first];
		for (let j = start.idx + 1; j < next; j++) {
			parts.push(sectionLines[j] ?? "");
		}
		const text = parts.join("\n").trim();
		if (text) steps.push(text);
	}
	return steps;
}
