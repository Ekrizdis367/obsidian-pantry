import { CachedMetadata } from "obsidian";
import { RECIPE_FRONTMATTER } from "../settings";

/**
 * Helpers for reading the Pantry-specific frontmatter fields off a recipe
 * note. All readers tolerate missing or malformed values - they return
 * sensible defaults rather than throwing - so callers can render even
 * partially-populated recipes without special casing.
 */

/** Aliases tolerated for each frontmatter key, in addition to the canonical name (case-insensitive). */
const KEY_ALIASES: Record<string, readonly string[]> = {
	[RECIPE_FRONTMATTER.diet]: ["diets", "dietary"],
	[RECIPE_FRONTMATTER.allergens]: ["allergen", "allergies"],
	[RECIPE_FRONTMATTER.prepTime]: ["prep", "prep_time", "preparation_time"],
	[RECIPE_FRONTMATTER.cookTime]: ["cook", "cook_time", "cooking_time"],
	[RECIPE_FRONTMATTER.totalTime]: ["total", "total_time", "time"],
	[RECIPE_FRONTMATTER.favorite]: ["favourite", "starred"],
	[RECIPE_FRONTMATTER.kidsApproved]: [
		"kids_approved",
		"kids-approved",
		"kidApproved",
		"kid_approved",
	],
	[RECIPE_FRONTMATTER.cookedCount]: [
		"cooked_count",
		"timesCooked",
		"times_cooked",
	],
};

function aliasesFor(key: string): readonly string[] {
	return [key, ...(KEY_ALIASES[key] ?? [])];
}

function findValue(
	frontmatter: Record<string, unknown>,
	keys: readonly string[],
): unknown {
	const lowered: Record<string, unknown> = {};
	for (const fmKey of Object.keys(frontmatter)) {
		lowered[fmKey.toLowerCase()] = frontmatter[fmKey];
	}
	for (const key of keys) {
		const value = lowered[key.toLowerCase()];
		if (value !== undefined && value !== null) return value;
	}
	return undefined;
}

/** Coerce a value to a normalized lowercase string array. Accepts arrays or a comma/semicolon-separated string. */
function toTagArray(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	const tokens: string[] = [];
	if (Array.isArray(value)) {
		for (const item of value) {
			if (typeof item === "string") tokens.push(item);
			else if (typeof item === "number" || typeof item === "boolean") {
				tokens.push(String(item));
			}
		}
	} else if (typeof value === "string") {
		tokens.push(...value.split(/[,;]/));
	} else {
		return [];
	}
	const out: string[] = [];
	const seen = new Set<string>();
	for (const token of tokens) {
		const cleaned = token.trim().toLowerCase();
		if (!cleaned || seen.has(cleaned)) continue;
		seen.add(cleaned);
		out.push(cleaned);
	}
	return out;
}

/** Parse a numeric value, tolerating strings like "15", "15 min", "1.5". */
function toNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const match = value.match(/-?\d+(?:\.\d+)?/);
		if (match) {
			const n = Number(match[0]);
			if (Number.isFinite(n)) return n;
		}
	}
	return null;
}

function toBoolean(value: unknown): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const v = value.trim().toLowerCase();
		return v === "true" || v === "yes" || v === "1";
	}
	if (typeof value === "number") return value !== 0;
	return false;
}

export function readDiet(frontmatter: Record<string, unknown>): string[] {
	return toTagArray(findValue(frontmatter, aliasesFor(RECIPE_FRONTMATTER.diet)));
}

export function readAllergens(frontmatter: Record<string, unknown>): string[] {
	return toTagArray(
		findValue(frontmatter, aliasesFor(RECIPE_FRONTMATTER.allergens)),
	);
}

export interface RecipeTimes {
	prep: number | null;
	cook: number | null;
	total: number | null;
}

/**
 * Read prep/cook/total times in minutes. If `total` is missing but both
 * `prep` and `cook` are present, total is computed from their sum.
 */
export function readTimes(frontmatter: Record<string, unknown>): RecipeTimes {
	const prep = toNumber(
		findValue(frontmatter, aliasesFor(RECIPE_FRONTMATTER.prepTime)),
	);
	const cook = toNumber(
		findValue(frontmatter, aliasesFor(RECIPE_FRONTMATTER.cookTime)),
	);
	let total = toNumber(
		findValue(frontmatter, aliasesFor(RECIPE_FRONTMATTER.totalTime)),
	);
	if (total === null && prep !== null && cook !== null) {
		total = prep + cook;
	}
	return { prep, cook, total };
}

export function readFavorite(frontmatter: Record<string, unknown>): boolean {
	return toBoolean(
		findValue(frontmatter, aliasesFor(RECIPE_FRONTMATTER.favorite)),
	);
}

/**
 * Read the kids-approved vote. Returns `true` (thumbs up), `false` (thumbs
 * down), or `null` when the property is absent or unset.
 */
export function readKidsApproved(
	frontmatter: Record<string, unknown>,
): boolean | null {
	const raw = findValue(
		frontmatter,
		aliasesFor(RECIPE_FRONTMATTER.kidsApproved),
	);
	if (raw === undefined || raw === null) return null;
	if (typeof raw === "boolean") return raw;
	if (typeof raw === "string") {
		const v = raw.trim().toLowerCase();
		if (v === "true" || v === "yes" || v === "1" || v === "up") return true;
		if (v === "false" || v === "no" || v === "0" || v === "down") {
			return false;
		}
		return null;
	}
	if (typeof raw === "number") {
		if (raw === 0) return false;
		return raw !== 0 ? true : null;
	}
	return null;
}

export function readCookedCount(frontmatter: Record<string, unknown>): number {
	const n = toNumber(
		findValue(frontmatter, aliasesFor(RECIPE_FRONTMATTER.cookedCount)),
	);
	if (n === null) return 0;
	return Math.max(0, Math.round(n));
}

/**
 * Read the `lastMade` value (as a YYYY-MM-DD string when possible). The
 * Obsidian metadata cache may surface dates as `Date` objects (when YAML
 * casts them) or as strings, so we normalize both.
 */
export function readLastMade(
	frontmatter: Record<string, unknown>,
	key: string,
): string | null {
	const raw = findValue(frontmatter, [key]);
	if (raw === undefined || raw === null) return null;
	if (typeof raw === "string") return raw.trim() || null;
	if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
		return formatLocalISO(raw);
	}
	return null;
}

export function formatLocalISO(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Format an integer minute count as e.g. "15m", "1h", "1h 20m". */
export function formatMinutes(minutes: number): string {
	const total = Math.max(0, Math.round(minutes));
	if (total < 60) return `${total}m`;
	const h = Math.floor(total / 60);
	const m = total % 60;
	if (m === 0) return `${h}h`;
	return `${h}h ${m}m`;
}

/** Compute the user's allergens that match a recipe's allergen list. */
export function matchingAllergens(
	recipeAllergens: readonly string[],
	myAllergens: readonly string[],
): string[] {
	if (recipeAllergens.length === 0 || myAllergens.length === 0) return [];
	const mine = new Set(myAllergens.map((a) => a.toLowerCase()));
	const out: string[] = [];
	for (const a of recipeAllergens) {
		if (mine.has(a.toLowerCase())) out.push(a);
	}
	return out;
}

/**
 * Convenience: pull the relevant Pantry metadata in one shot, given an
 * Obsidian metadata cache entry. Returns null if the file has no
 * frontmatter at all (in which case there's nothing useful to read).
 */
export interface RecipeMeta {
	diet: string[];
	allergens: string[];
	times: RecipeTimes;
	favorite: boolean;
	/** `true` = kids approved, `false` = not approved, `null` = no vote. */
	kidsApproved: boolean | null;
	cookedCount: number;
	lastMade: string | null;
}

export function readRecipeMeta(
	cache: CachedMetadata | null,
	lastMadeKey: string,
): RecipeMeta {
	const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
	return {
		diet: readDiet(fm),
		allergens: readAllergens(fm),
		times: readTimes(fm),
		favorite: readFavorite(fm),
		kidsApproved: readKidsApproved(fm),
		cookedCount: readCookedCount(fm),
		lastMade: readLastMade(fm, lastMadeKey),
	};
}

/** Number of days between today (local) and an ISO date string. Returns null if unparseable. */
export function daysSince(iso: string | null): number | null {
	if (!iso) return null;
	const parts = iso.split("-").map((p) => Number(p));
	if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
	const [y, m, d] = parts as [number, number, number];
	const past = new Date(y, m - 1, d);
	if (Number.isNaN(past.getTime())) return null;
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const diffMs = today.getTime() - past.getTime();
	return Math.floor(diffMs / 86_400_000);
}
