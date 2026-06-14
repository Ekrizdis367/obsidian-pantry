import { ImportedRecipe } from "./types";

const JSON_LD_RE =
	/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Extract structured recipe data from HTML by reading schema.org JSON-LD.
 * No third-party dependencies — most recipe sites embed a Recipe object this way.
 */
export function extractRecipe(html: string, sourceUrl: string): ImportedRecipe | null {
	const nodes = collectJsonLdNodes(html);
	for (const node of nodes) {
		if (!isRecipeNode(node)) continue;
		const recipe = mapRecipeNode(node, sourceUrl);
		if (recipe.title) return recipe;
	}
	return null;
}

function collectJsonLdNodes(html: string): unknown[] {
	const out: unknown[] = [];
	let match: RegExpExecArray | null;
	JSON_LD_RE.lastIndex = 0;
	while ((match = JSON_LD_RE.exec(html)) !== null) {
		const raw = (match[1] ?? "").trim();
		if (!raw) continue;
		try {
			const parsed: unknown = JSON.parse(raw);
			flattenJsonLd(parsed, out);
		} catch {
			// Malformed JSON-LD blocks are common on the web; skip them.
		}
	}
	return out;
}

function flattenJsonLd(value: unknown, out: unknown[]): void {
	if (Array.isArray(value)) {
		for (const entry of value) flattenJsonLd(entry, out);
		return;
	}
	if (!value || typeof value !== "object") return;

	const obj = value as Record<string, unknown>;
	if (Array.isArray(obj["@graph"])) {
		for (const entry of obj["@graph"]) flattenJsonLd(entry, out);
	}
	out.push(obj);
}

function isRecipeNode(node: unknown): node is Record<string, unknown> {
	if (!node || typeof node !== "object") return false;
	const type = (node as Record<string, unknown>)["@type"];
	if (typeof type === "string") {
		return type.toLowerCase() === "recipe";
	}
	if (Array.isArray(type)) {
		return type.some(
			(entry) =>
				typeof entry === "string" && entry.toLowerCase() === "recipe",
		);
	}
	return false;
}

function mapRecipeNode(
	node: Record<string, unknown>,
	sourceUrl: string,
): ImportedRecipe {
	const prepTime = parseDurationMinutes(node["prepTime"]);
	const cookTime = parseDurationMinutes(node["cookTime"]);
	let totalTime = parseDurationMinutes(node["totalTime"]);
	if (totalTime === null && prepTime !== null && cookTime !== null) {
		totalTime = prepTime + cookTime;
	}

	const nutrition = readNutrition(node["nutrition"]);

	return {
		title: readText(node["name"]) ?? "",
		description: readText(node["description"]) ?? "",
		image: readImage(node["image"]),
		servings: readText(node["recipeYield"]) ?? readText(node["yield"]) ?? "",
		prepTime,
		cookTime,
		totalTime,
		ingredientLines: readIngredients(node["recipeIngredient"]),
		instructionSteps: readInstructions(node["recipeInstructions"]),
		sourceUrl,
		...nutrition,
	};
}

function readNutrition(value: unknown): {
	calories: number | null;
	protein: number | null;
	fat: number | null;
	carbs: number | null;
} {
	const obj =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	return {
		calories: parseNutrientNumber(obj["calories"]),
		protein: parseNutrientNumber(
			obj["proteinContent"] ?? obj["protein"],
		),
		fat: parseNutrientNumber(obj["fatContent"] ?? obj["fat"]),
		carbs: parseNutrientNumber(
			obj["carbohydrateContent"] ?? obj["carbohydrates"],
		),
	};
}

function parseNutrientNumber(value: unknown): number | null {
	const text = readText(value);
	if (!text) return null;
	const match = text.match(/(\d+(?:\.\d+)?)/);
	if (!match) return null;
	const n = Number(match[1]);
	return Number.isFinite(n) ? Math.round(n) : null;
}

function readIngredients(value: unknown): string[] {
	if (!value) return [];
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? [trimmed] : [];
	}
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const entry of value) {
		const text = readText(entry);
		if (text) out.push(text);
	}
	return out;
}

function readInstructions(value: unknown): string[] {
	if (!value) return [];
	if (typeof value === "string") {
		return value
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
	}
	if (!Array.isArray(value)) return [];

	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry === "string") {
			const text = entry.trim();
			if (text) out.push(text);
			continue;
		}
		if (!entry || typeof entry !== "object") continue;
		const obj = entry as Record<string, unknown>;
		const type = readType(obj["@type"]);

		if (type === "howtosection") {
			const sectionName = readText(obj["name"]);
			const items = readInstructions(obj["itemListElement"]);
			if (sectionName && items.length > 0) {
				out.push(`**${sectionName}**`);
			}
			out.push(...items);
			continue;
		}

		const stepText =
			readText(obj["text"]) ??
			readText(obj["name"]) ??
			readText(obj["description"]);
		if (stepText) out.push(stepText);
	}
	return out;
}

function readType(value: unknown): string {
	if (typeof value === "string") return value.toLowerCase();
	if (Array.isArray(value)) {
		for (const entry of value) {
			if (typeof entry === "string") return entry.toLowerCase();
		}
	}
	return "";
}

function readImage(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (Array.isArray(value)) {
		for (const entry of value) {
			const url = readImage(entry);
			if (url) return url;
		}
		return "";
	}
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		return readText(obj["url"]) ?? readText(obj["contentUrl"]) ?? "";
	}
	return "";
}

function readText(value: unknown): string | null {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed || null;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		return readText(obj["@value"] ?? obj["text"] ?? obj["name"]);
	}
	return null;
}

/**
 * Parse ISO-8601 durations (PT30M, PT1H30M, P0DT1H30M) into whole minutes.
 * Also accepts plain numbers and strings like "30 minutes".
 */
export function parseDurationMinutes(value: unknown): number | null {
	const text = readText(value);
	if (!text) return null;

	if (/^PT/i.test(text) || /^P/i.test(text)) {
		const hours = text.match(/(\d+(?:\.\d+)?)\s*H/i);
		const minutes = text.match(/(\d+(?:\.\d+)?)\s*M/i);
		const h = hours ? Number(hours[1]) : 0;
		const m = minutes ? Number(minutes[1]) : 0;
		if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
		const total = Math.round(h * 60 + m);
		return total > 0 ? total : null;
	}

	const match = text.match(/(\d+(?:\.\d+)?)/);
	if (!match) return null;
	const n = Number(match[1]);
	if (!Number.isFinite(n)) return null;
	return Math.round(n);
}
