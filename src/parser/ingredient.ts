import { ParsedIngredient } from "../types";
import { parseLeadingQuantity } from "./quantity";

/**
 * Recognised units. Each entry maps any spelling to a canonical singular form
 * so quantities can be aggregated regardless of pluralisation.
 */
const UNIT_MAP: Record<string, string> = {
	tsp: "tsp",
	tsps: "tsp",
	teaspoon: "tsp",
	teaspoons: "tsp",
	tbsp: "tbsp",
	tbsps: "tbsp",
	tablespoon: "tbsp",
	tablespoons: "tbsp",
	cup: "cup",
	cups: "cup",
	c: "cup",
	pt: "pt",
	pint: "pt",
	pints: "pt",
	qt: "qt",
	quart: "qt",
	quarts: "qt",
	gal: "gal",
	gallon: "gal",
	gallons: "gal",
	ml: "ml",
	milliliter: "ml",
	milliliters: "ml",
	millilitre: "ml",
	millilitres: "ml",
	l: "l",
	liter: "l",
	liters: "l",
	litre: "l",
	litres: "l",
	floz: "fl oz",
	"fl oz": "fl oz",
	"fluid ounce": "fl oz",
	"fluid ounces": "fl oz",
	oz: "oz",
	ounce: "oz",
	ounces: "oz",
	lb: "lb",
	lbs: "lb",
	pound: "lb",
	pounds: "lb",
	g: "g",
	gram: "g",
	grams: "g",
	kg: "kg",
	kilogram: "kg",
	kilograms: "kg",
	mg: "mg",
	milligram: "mg",
	milligrams: "mg",
	piece: "piece",
	pieces: "piece",
	can: "can",
	cans: "can",
	jar: "jar",
	jars: "jar",
	bag: "bag",
	bags: "bag",
	box: "box",
	boxes: "box",
	bottle: "bottle",
	bottles: "bottle",
	pack: "pack",
	packs: "pack",
	package: "pack",
	packages: "pack",
	bunch: "bunch",
	bunches: "bunch",
	head: "head",
	heads: "head",
	clove: "clove",
	cloves: "clove",
	slice: "slice",
	slices: "slice",
	stick: "stick",
	sticks: "stick",
	pinch: "pinch",
	pinches: "pinch",
	dash: "dash",
	dashes: "dash",
	sprig: "sprig",
	sprigs: "sprig",
	stalk: "stalk",
	stalks: "stalk",
	loaf: "loaf",
	loaves: "loaf",
	dozen: "dozen",
	unit: "",
	units: "",
	whole: "",
	each: "",
};

/**
 * Strip leading list markers ("- ", "* ", "1. ") and inline checkbox syntax.
 *
 * Re-runs the bullet/checkbox passes so cases like "- [ ] - 3 lb beef" (where
 * the user double-bullets after the checkbox) collapse to "3 lb beef".
 */
function stripListMarkers(line: string): string {
	let prev = "";
	let out = line;
	while (out !== prev) {
		prev = out;
		out = out.replace(/^\s*[-*+]\s+/, "");
		out = out.replace(/^\s*\d+\.\s+/, "");
		out = out.replace(/^\[.\]\s+/, "");
		out = out.trim();
	}
	return out;
}

/** Pull a trailing parenthetical note like "(optional)" or "(diced)". */
function extractTrailingNotes(text: string): {
	text: string;
	note: string | null;
} {
	const match = text.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
	if (!match) return { text: text.trim(), note: null };
	const before = (match[1] ?? "").trim();
	const note = (match[2] ?? "").trim();
	// A line that is only a parenthetical has no ingredient name to keep.
	if (!before) return { text: text.trim(), note: null };
	return { text: before, note: note || null };
}

/**
 * Pull trailing Obsidian-style #tags (`... #Meat #Spicy`) off the line.
 *
 * Returns the cleaned text and the tags (in order, without the leading `#`).
 * Only tags that appear at the very end of the line are extracted, so an
 * inline `#1` in something like `pan #1` is left alone.
 */
function extractTrailingTags(text: string): { text: string; tags: string[] } {
	const match = text.match(/((?:\s+#[\w/-]+)+)\s*$/);
	if (!match) return { text: text.trim(), tags: [] };
	const tagBlock = match[1] ?? "";
	const tags: string[] = [];
	for (const raw of tagBlock.split(/\s+/)) {
		const cleaned = raw.replace(/^#/, "").trim();
		if (cleaned) tags.push(cleaned);
	}
	return {
		text: text.slice(0, match.index ?? text.length).trim(),
		tags,
	};
}

/**
 * Strip markdown bold/italic markers (** *** __) without removing inline content.
 *
 * We deliberately leave single `*` / `_` alone so we don't accidentally chew
 * through legitimate punctuation in ingredient names (e.g. "all-purpose").
 */
function stripMarkdownEmphasis(text: string): string {
	return text
		.replace(/\*\*\*/g, "")
		.replace(/\*\*/g, "")
		.replace(/__/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Drop common "of" connectors after a unit, e.g. "1 cup of flour" -> "1 cup flour". */
function stripOf(text: string): string {
	return text.replace(/^of\s+/i, "");
}

/**
 * Try to peel off a unit token from the start of `rest`. Supports
 * single tokens ("cup") and the multi-token "fl oz".
 */
function consumeUnit(rest: string): { unit: string; rest: string } {
	const lower = rest.toLowerCase();
	const twoWord = lower.match(/^(fl\s+oz|fluid\s+ounce|fluid\s+ounces)\b\s*(.*)$/);
	if (twoWord) {
		return { unit: "fl oz", rest: twoWord[2] ?? "" };
	}
	const oneWord = rest.match(/^([A-Za-z]+)\b\.?\s*(.*)$/);
	if (oneWord) {
		const candidate = (oneWord[1] ?? "").toLowerCase();
		const canonical = UNIT_MAP[candidate];
		// Some "units" like "unit", "whole", or "each" are just filler words:
		// consume them so they don't end up in the name, but contribute no
		// canonical unit so quantities still aggregate naturally.
		if (canonical !== undefined) {
			return { unit: canonical, rest: oneWord[2] ?? "" };
		}
	}
	return { unit: "", rest };
}

/**
 * Parse a single ingredient line.
 *
 * Returns null when the line is empty or clearly not an ingredient
 * (e.g. a blank list bullet).
 */
export function parseIngredientLine(line: string): ParsedIngredient | null {
	const cleaned = stripListMarkers(line);
	if (!cleaned) return null;

	const deemphasised = stripMarkdownEmphasis(cleaned);
	const { text: withoutTags, tags } = extractTrailingTags(deemphasised);
	const { text: withoutNotes, note } = extractTrailingNotes(withoutTags);
	if (!withoutNotes) return null;

	const { quantity, rest: afterQty } = parseLeadingQuantity(withoutNotes);
	const afterOf = stripOf(afterQty.trim());

	let unit = "";
	let name = afterOf;

	if (quantity !== null && afterOf) {
		const consumed = consumeUnit(afterOf);
		if (consumed.unit !== undefined && consumed.rest !== afterOf) {
			unit = consumed.unit;
			name = stripOf(consumed.rest.trim());
		}
	}

	name = name.replace(/[,;]+$/g, "").trim();
	if (!name) {
		// e.g. just a number with no name: skip.
		return null;
	}

	return {
		quantity,
		unit,
		name: normaliseName(name),
		note,
		tags,
		raw: cleaned,
	};
}

/**
 * Normalise an ingredient name so "Eggs", "eggs", and " eggs " consolidate.
 * Keeps internal punctuation that is meaningful (e.g. "all-purpose flour").
 */
export function normaliseName(name: string): string {
	return name
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/^[-–—\s]+|[-–—\s]+$/g, "")
		.trim();
}

/**
 * Build a stable consolidation key. Items consolidate when their
 * normalised name and canonical unit match.
 */
export function ingredientKey(name: string, unit: string): string {
	return `${normaliseName(name)}|${unit.toLowerCase().trim()}`;
}

/**
 * Returns true if `tags` contains the ignore-ingredient marker.
 *
 * Accepts case-insensitive variants like `#IgnoreIngredient`,
 * `#ignoreingredient`, `#ignore-ingredient`, `#ignore_ingredient`.
 */
export function hasIgnoreTag(tags: readonly string[]): boolean {
	return tags.some((tag) => normaliseTag(tag) === "ignoreingredient");
}

function normaliseTag(tag: string): string {
	return tag.toLowerCase().replace(/[-_]/g, "");
}
