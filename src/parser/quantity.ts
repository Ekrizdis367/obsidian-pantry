/**
 * Parse a leading quantity from an ingredient string.
 *
 * Supports:
 *   - whole numbers:        "2 cups flour"
 *   - decimals:             "0.5 lb butter"
 *   - simple fractions:     "1/2 cup milk"
 *   - mixed fractions:      "1 1/2 cups sugar"
 *   - unicode fractions:    "½ cup sugar"
 *   - leading "a" / "an":   "a pinch of salt" -> 1
 *
 * Returns the parsed quantity (or null) along with the remaining text.
 */
import { regexCapture } from "../utils/text";

const UNICODE_FRACTIONS: Record<string, number> = {
	"¼": 0.25,
	"½": 0.5,
	"¾": 0.75,
	"⅓": 1 / 3,
	"⅔": 2 / 3,
	"⅕": 0.2,
	"⅖": 0.4,
	"⅗": 0.6,
	"⅘": 0.8,
	"⅙": 1 / 6,
	"⅚": 5 / 6,
	"⅛": 0.125,
	"⅜": 0.375,
	"⅝": 0.625,
	"⅞": 0.875,
};

export interface QuantityParseResult {
	quantity: number | null;
	rest: string;
}

/** ASCII slash plus the unicode fraction slash (U+2044) used by some recipe sites. */
const FRACTION_SLASH = "[/\u2044]";

export function parseLeadingQuantity(input: string): QuantityParseResult {
	const trimmed = input.trim();
	if (!trimmed) return { quantity: null, rest: "" };

	// Adjacent unicode fraction with whole number, no space: "2½ cups"
	const adjacentUnicode = trimmed.match(/^(\d+)([¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])\s*(.*)$/);
	if (adjacentUnicode) {
		const whole = Number(regexCapture(adjacentUnicode, 1));
		const fracChar = regexCapture(adjacentUnicode, 2);
		const frac = UNICODE_FRACTIONS[fracChar] ?? 0;
		return {
			quantity: whole + frac,
			rest: regexCapture(adjacentUnicode, 3),
		};
	}

	// Mixed fraction: "1 1/2"
	const mixed = trimmed.match(
		new RegExp(`^(\\d+)\\s+(\\d+)${FRACTION_SLASH}(\\d+)\\b\\s*(.*)$`),
	);
	if (mixed) {
		const whole = Number(regexCapture(mixed, 1));
		const num = Number(regexCapture(mixed, 2));
		const den = Number(regexCapture(mixed, 3));
		if (den !== 0) {
			return {
				quantity: whole + num / den,
				rest: regexCapture(mixed, 4),
			};
		}
	}

	// Simple fraction: "1/2"
	const fraction = trimmed.match(
		new RegExp(`^(\\d+)${FRACTION_SLASH}(\\d+)\\b\\s*(.*)$`),
	);
	if (fraction) {
		const num = Number(regexCapture(fraction, 1));
		const den = Number(regexCapture(fraction, 2));
		if (den !== 0) {
			return {
				quantity: num / den,
				rest: regexCapture(fraction, 3),
			};
		}
	}

	// Decimal or integer: "1.5" / "2"
	const numeric = trimmed.match(/^(\d+(?:\.\d+)?)\b\s*(.*)$/);
	if (numeric) {
		return {
			quantity: Number(regexCapture(numeric, 1)),
			rest: regexCapture(numeric, 2),
		};
	}

	// Leading unicode fraction (with optional whole number prefix).
	const firstChar = trimmed[0];
	if (firstChar !== undefined) {
		const value = UNICODE_FRACTIONS[firstChar];
		if (value !== undefined) {
			return {
				quantity: value,
				rest: trimmed.slice(1).trimStart(),
			};
		}
	}

	// "a" / "an" -> 1, only when followed by a space and at least one more word.
	const article = trimmed.match(/^(a|an)\s+(\S.*)$/i);
	if (article) {
		return { quantity: 1, rest: regexCapture(article, 2) };
	}

	return { quantity: null, rest: trimmed };
}

/**
 * Format a numeric quantity for display.
 *
 * Tries to express the value as a kitchen-friendly fraction (denominators
 * 2, 3, 4, 6, or 8). When the value is too far from any of those, falls
 * back to a decimal trimmed to two places.
 *
 * Examples:
 *   1.5           -> "1 1/2"
 *   0.6666...     -> "2/3"      (sum of 1/3 + 1/3)
 *   0.8333...     -> "5/6"      (sum of 1/2 + 1/3)
 *   1.99 (drift)  -> "2"        (snap-to-whole within tolerance)
 *   0.4           -> "0.4"      (no clean fraction, keep decimal)
 */
export function formatQuantity(qty: number | null): string {
	if (qty === null || Number.isNaN(qty)) return "";
	if (qty === 0) return "0";

	const sign = qty < 0 ? "-" : "";
	const abs = Math.abs(qty);

	const whole = Math.floor(abs);
	const frac = abs - whole;
	const snapTolerance = 0.02;

	if (frac < snapTolerance) return `${sign}${whole}`;
	if (frac > 1 - snapTolerance) return `${sign}${whole + 1}`;

	const best = approximateFraction(frac);
	if (best) {
		const fractionPart = `${best.num}/${best.den}`;
		return whole === 0
			? `${sign}${fractionPart}`
			: `${sign}${whole} ${fractionPart}`;
	}

	return `${sign}${Number(abs.toFixed(2)).toString()}`;
}

/**
 * Find the closest fraction with a small kitchen-standard denominator
 * within a tight tolerance. Returns null when nothing is close enough.
 *
 * Smaller denominators are preferred on ties, so 0.5 -> 1/2 rather than 4/8.
 */
function approximateFraction(
	frac: number,
): { num: number; den: number } | null {
	if (frac <= 0 || frac >= 1) return null;
	const denominators = [2, 3, 4, 6, 8];
	const tolerance = 0.04;
	let best: { num: number; den: number; error: number } | null = null;
	for (const den of denominators) {
		const num = Math.round(frac * den);
		if (num <= 0 || num >= den) continue;
		const error = Math.abs(frac - num / den);
		if (error > tolerance) continue;
		if (!best || error < best.error - 1e-6) {
			best = { num, den, error };
		}
	}
	return best ? { num: best.num, den: best.den } : null;
}
