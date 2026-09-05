/**
 * Shared with Coach: how recipe frontmatter nutrition numbers are authored.
 *
 * Default (absent / false): values are **recipe totals**. Per-serving display
 * divides by `servings`. Coach divides by `servings` when logging one serving.
 *
 * `perServing: true` (or `per-serving: true`): values are **already per serving**.
 * Pantry shows them as-is in per-serving mode and multiplies by servings for
 * totals. Coach skips dividing when logging one serving.
 */

/** True when frontmatter marks nutrition as already per-serving. */
export function isNutritionPerServing(
	frontmatter: Record<string, unknown> | null | undefined,
): boolean {
	if (!frontmatter) return false;
	const raw =
		frontmatter["perServing"] ??
		frontmatter["per-serving"] ??
		frontmatter["perserving"];
	if (typeof raw === "boolean") return raw;
	if (typeof raw === "string") {
		const lower = raw.trim().toLowerCase();
		return lower === "true" || lower === "yes" || lower === "1";
	}
	if (typeof raw === "number") return raw === 1;
	return false;
}

/**
 * Convert a frontmatter nutrition number into the value for the requested
 * display mode, given servings and whether the source is already per-serving.
 */
export function resolveNutritionDisplayValue(
	rawValue: number,
	servings: number | null,
	sourceIsPerServing: boolean,
	displayMode: "per-serving" | "total",
): number {
	const safeServings =
		servings !== null && servings > 0 ? servings : null;

	if (displayMode === "per-serving") {
		if (sourceIsPerServing) return rawValue;
		if (safeServings !== null) return rawValue / safeServings;
		return rawValue;
	}

	// displayMode === "total"
	if (sourceIsPerServing && safeServings !== null) {
		return rawValue * safeServings;
	}
	return rawValue;
}
