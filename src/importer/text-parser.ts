import { parseLeadingQuantity } from "../parser/quantity";
import { forEachRegexCapture } from "../utils/text";
import { ImportedRecipe } from "./types";

/**
 * Parse free-form pasted recipe text into a structured recipe.
 *
 * Two strategies, tried in order:
 *  1. Header-based: locate "Ingredients" and "Instructions"-style section
 *     headers and read the lines beneath each. Works for most copied or
 *     emailed recipes, which keep those labels.
 *  2. Heuristic fallback: when no headers are present, classify lines by
 *     whether they look like an ingredient (leading quantity) versus a
 *     longer instruction sentence.
 *
 * Always returns a recipe (possibly with empty sections) so the caller can
 * decide whether there's enough to import.
 */
export function parseRecipeText(
	text: string,
	titleOverride?: string,
): ImportedRecipe {
	const rawLines = text.split(/\r?\n/);
	const lines = rawLines.map((l) => l.trim());

	const meta = extractMeta(lines);
	const headerParse = parseByHeaders(lines);
	const { ingredientLines, instructionSteps } =
		headerParse.ingredientLines.length > 0 ||
		headerParse.instructionSteps.length > 0
			? headerParse
			: parseByHeuristics(lines);

	const title =
		(titleOverride?.trim() || "") ||
		deriveTitle(lines) ||
		"Imported Recipe";

	return {
		title,
		description: "",
		image: "",
		servings: meta.servings,
		prepTime: meta.prepTime,
		cookTime: meta.cookTime,
		totalTime: meta.totalTime,
		ingredientLines,
		instructionSteps,
		sourceUrl: "",
		calories: null,
		protein: null,
		fat: null,
		carbs: null,
		fiber: null,
	};
}

const INGREDIENTS_HEADER_RE =
	/^#{0,6}\s*(ingredients?)\b\s*:?\s*$/i;
const INSTRUCTIONS_HEADER_RE =
	/^#{0,6}\s*(instructions?|directions?|method|steps|preparation)\b\s*:?\s*$/i;
const ANY_HEADER_RE =
	/^#{0,6}\s*(ingredients?|instructions?|directions?|method|steps|preparation|notes?|nutrition|tips?|equipment)\b\s*:?\s*$/i;

function parseByHeaders(lines: string[]): {
	ingredientLines: string[];
	instructionSteps: string[];
} {
	const ingredientLines: string[] = [];
	const instructionSteps: string[] = [];

	let mode: "none" | "ingredients" | "instructions" = "none";
	for (const line of lines) {
		if (INGREDIENTS_HEADER_RE.test(line)) {
			mode = "ingredients";
			continue;
		}
		if (INSTRUCTIONS_HEADER_RE.test(line)) {
			mode = "instructions";
			continue;
		}
		if (ANY_HEADER_RE.test(line)) {
			// A different recognised section (Notes, Nutrition, …) ends capture.
			mode = "none";
			continue;
		}
		if (!line) continue;

		if (mode === "ingredients") {
			ingredientLines.push(stripListMarker(line));
		} else if (mode === "instructions") {
			instructionSteps.push(stripListMarker(line));
		}
	}

	return { ingredientLines, instructionSteps };
}

function parseByHeuristics(lines: string[]): {
	ingredientLines: string[];
	instructionSteps: string[];
} {
	const ingredientLines: string[] = [];
	const instructionSteps: string[] = [];

	for (const line of lines) {
		if (!line || ANY_HEADER_RE.test(line)) continue;
		const body = stripListMarker(line);
		if (!body) continue;
		if (looksLikeIngredient(body)) ingredientLines.push(body);
		else instructionSteps.push(body);
	}

	return { ingredientLines, instructionSteps };
}

/**
 * An ingredient line usually starts with a quantity ("2 cups…", "½ tsp…",
 * "1 1/2 lb…") and is short. Instruction sentences tend to be longer prose.
 */
function looksLikeIngredient(line: string): boolean {
	const { quantity } = parseLeadingQuantity(line);
	if (quantity !== null) return true;
	// No quantity: treat very short fragments without sentence punctuation as
	// ingredients (e.g. "Salt", "Olive oil"), longer prose as instructions.
	const wordCount = line.split(/\s+/).length;
	const hasSentenceEnd = /[.!?]\s|[.!?]$/.test(line);
	return wordCount <= 6 && !hasSentenceEnd;
}

function stripListMarker(line: string): string {
	return line
		.replace(/^\s*[-*+]\s+/, "")
		.replace(/^\s*\d+[.)]\s+/, "")
		.replace(/^\s*[•·▢□☐]\s*/, "")
		.trim();
}

function deriveTitle(lines: string[]): string {
	for (const line of lines) {
		if (!line) continue;
		const heading = line.match(/^#{1,6}\s+(.*)$/);
		if (heading) return (heading[1] ?? "").trim();
		if (ANY_HEADER_RE.test(line)) continue;
		// First meaningful non-header line.
		return stripListMarker(line);
	}
	return "";
}

interface TextMeta {
	servings: string;
	prepTime: number | null;
	cookTime: number | null;
	totalTime: number | null;
}

function extractMeta(lines: string[]): TextMeta {
	let servings = "";
	let prepTime: number | null = null;
	let cookTime: number | null = null;
	let totalTime: number | null = null;

	for (const line of lines) {
		if (!servings) {
			const m = line.match(
				/(?:serves|servings?|yields?|makes)\s*[:-]?\s*(\d+(?:\s*[-–]\s*\d+)?)/i,
			);
			if (m) servings = (m[1] ?? "").trim();
		}
		if (prepTime === null) {
			const m = line.match(/prep(?:\s*time)?\s*[:-]?\s*(.+)$/i);
			if (m) prepTime = parseHumanDuration(m[1] ?? "");
		}
		if (cookTime === null) {
			const m = line.match(/cook(?:\s*time)?\s*[:-]?\s*(.+)$/i);
			if (m) cookTime = parseHumanDuration(m[1] ?? "");
		}
		if (totalTime === null) {
			const m = line.match(/total(?:\s*time)?\s*[:-]?\s*(.+)$/i);
			if (m) totalTime = parseHumanDuration(m[1] ?? "");
		}
	}

	if (totalTime === null && prepTime !== null && cookTime !== null) {
		totalTime = prepTime + cookTime;
	}

	return { servings, prepTime, cookTime, totalTime };
}

/**
 * Parse a human-written duration into minutes, e.g. "1 hour 30 minutes",
 * "90 mins", "1.5 hrs", "45m". Sums every hour and minute value found so
 * combined phrases aren't truncated to their first number.
 */
function parseHumanDuration(text: string): number | null {
	let minutes = 0;
	let matched = false;

	const hourRe = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/gi;
	const minRe = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/gi;

	forEachRegexCapture(text, hourRe, (capture) => {
		const n = Number(capture);
		if (Number.isFinite(n)) {
			minutes += n * 60;
			matched = true;
		}
	});
	forEachRegexCapture(text, minRe, (capture) => {
		const n = Number(capture);
		if (Number.isFinite(n)) {
			minutes += n;
			matched = true;
		}
	});

	if (matched) {
		const rounded = Math.round(minutes);
		return rounded > 0 ? rounded : null;
	}

	// No unit words — fall back to a bare leading number ("Prep: 15").
	const bare = text.match(/(\d+(?:\.\d+)?)/);
	if (!bare) return null;
	const n = Number(bare[1]);
	if (!Number.isFinite(n)) return null;
	const rounded = Math.round(n);
	return rounded > 0 ? rounded : null;
}
