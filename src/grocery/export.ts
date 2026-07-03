import { groupForDisplay } from "./aggregator";
import { formatQuantity } from "../parser/quantity";
import { PantrySettings } from "../settings";
import { GroceryItem } from "../types";
import { toTitleCase } from "../utils/text";

export type ExportFormat = "plain" | "checklist" | "grouped";

const FORMAT_LABELS: Record<ExportFormat, string> = {
	plain: "Plain text",
	checklist: "Markdown checklist",
	grouped: "Markdown grouped by category",
};

export function exportFormatLabel(format: ExportFormat): string {
	return FORMAT_LABELS[format];
}

interface ExportOptions {
	includeChecked: boolean;
}

const DEFAULT_OPTIONS: ExportOptions = { includeChecked: true };

/**
 * Render the grocery list to a string in the requested format.
 *
 * Plain and checklist formats produce a single flat list (alphabetised).
 * Grouped follows the user's display grouping (category by default), so
 * the export reads the way the in-app view does.
 */
export function exportGroceryList(
	items: readonly GroceryItem[],
	settings: PantrySettings,
	format: ExportFormat,
	options: ExportOptions = DEFAULT_OPTIONS,
): string {
	const filtered = options.includeChecked
		? [...items]
		: items.filter((i) => !i.checked);

	if (filtered.length === 0) return "";

	if (format === "grouped") {
		return renderGrouped(filtered, settings, options);
	}
	return renderFlat(filtered, format, options);
}

function renderFlat(
	items: readonly GroceryItem[],
	format: ExportFormat,
	options: ExportOptions,
): string {
	const sorted = [...items].sort((a, b) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
	);
	return sorted.map((item) => renderLine(item, format, options)).join("\n");
}

function renderGrouped(
	items: readonly GroceryItem[],
	settings: PantrySettings,
	options: ExportOptions,
): string {
	const groups = groupForDisplay([...items], settings);
	const out: string[] = [];
	for (const [name, groupItems] of groups) {
		if (groupItems.length === 0) continue;
		out.push(`## ${name}`);
		for (const item of groupItems) {
			out.push(renderLine(item, "checklist", options));
		}
		out.push("");
	}
	const text = out.join("\n").trimEnd();
	return text;
}

function renderLine(
	item: GroceryItem,
	format: ExportFormat,
	options: ExportOptions,
): string {
	const name = toTitleCase(item.name);
	const qty = [formatQuantity(item.quantity), item.unit]
		.filter(Boolean)
		.join(" ");
	const text = qty ? `${name} (${qty})` : name;
	if (format === "plain") return text;
	const checkbox = options.includeChecked && item.checked ? "[x]" : "[ ]";
	return `- ${checkbox} ${text}`;
}
