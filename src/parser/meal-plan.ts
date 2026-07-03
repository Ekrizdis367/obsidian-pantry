import { App, TFile } from "obsidian";
import { fileInRecipeFolders } from "./recipe";
import {
	MEAL_PLAN_MARKER,
	PantrySettings,
} from "../settings";
import { trimEndText } from "../utils/text";

/**
 * A single recipe appearance inside a meal-plan note. Each wikilink to a
 * recipe is its own occurrence so a recipe listed three times across the
 * week contributes its ingredients three times.
 */
export interface PlanOccurrence {
	file: TFile;
	/** The `## ` heading the link appeared under (e.g. "Monday"); "" when none. */
	day: string;
	/** The meal label the link appeared under (e.g. "Dinner"); "" when none. */
	slot: string;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
// Capture a list item whose body starts with a "Label:" prefix, allowing the
// label to be wrapped in ** or __ emphasis. Group 1 = label, group 2 = rest.
const SLOT_LABEL_RE =
	/^\s*[-*+]\s+(?:\*\*|__)?\s*([A-Za-z][^:*_]*?)\s*(?:\*\*|__)?\s*:\s*(.*)$/;
// A bare list item (no label) - everything after the marker is the body.
const LIST_ITEM_RE = /^\s*[-*+]\s+(.*)$/;
// Wikilink target, ignoring any |alias or #heading suffix.
const WIKILINK_RE = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;

/** True when a note was generated/owned by Pantry's planner. */
export function isPlannerManaged(contents: string): boolean {
	return contents.includes(MEAL_PLAN_MARKER);
}

/**
 * Parse a meal-plan note into an ordered list of recipe occurrences.
 *
 * Walks the note line by line, tracking the current `## ` day heading and
 * the current meal label, and resolves every wikilink to a markdown file in
 * the configured recipe folders. Links that don't resolve (or fall outside
 * the recipe folders) are skipped silently and surfaced via `unresolved`.
 */
export function parseMealPlanContents(
	app: App,
	notePath: string,
	contents: string,
	settings: PantrySettings,
): { occurrences: PlanOccurrence[]; unresolved: string[] } {
	const occurrences: PlanOccurrence[] = [];
	const unresolved: string[] = [];

	let currentDay = "";
	let currentSlot = "";

	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine;

		const heading = line.match(HEADING_RE);
		if (heading) {
			// Treat any heading as a potential day boundary; reset the slot.
			currentDay = (heading[2] ?? "").trim();
			currentSlot = "";
			continue;
		}

		let body = line;
		const labelled = line.match(SLOT_LABEL_RE);
		if (labelled) {
			currentSlot = (labelled[1] ?? "").trim();
			body = labelled[2] ?? "";
		} else {
			const item = line.match(LIST_ITEM_RE);
			if (item) body = item[1] ?? "";
		}

		for (const link of extractWikilinks(body)) {
			const dest = app.metadataCache.getFirstLinkpathDest(
				link,
				notePath,
			);
			if (
				dest instanceof TFile &&
				dest.extension === "md" &&
				fileInRecipeFolders(dest, settings.recipeFolders)
			) {
				occurrences.push({
					file: dest,
					day: currentDay,
					slot: currentSlot,
				});
			} else {
				unresolved.push(link);
			}
		}
	}

	return { occurrences, unresolved };
}

function extractWikilinks(text: string): string[] {
	const out: string[] = [];
	let match: RegExpExecArray | null;
	WIKILINK_RE.lastIndex = 0;
	while ((match = WIKILINK_RE.exec(text)) !== null) {
		const target = (match[1] ?? "").trim();
		if (target) out.push(target);
	}
	return out;
}

/** A planner grid: ordered days, each mapping a slot to its recipe files. */
export interface MealPlanGrid {
	days: string[];
	slots: string[];
	/** cells[day][slot] = recipe files in insertion order (duplicates allowed). */
	cells: Record<string, Record<string, TFile[]>>;
}

/** Build an empty grid for the given days and slots. */
export function emptyGrid(days: string[], slots: string[]): MealPlanGrid {
	const cells: Record<string, Record<string, TFile[]>> = {};
	for (const day of days) {
		cells[day] = {};
		for (const slot of slots) cells[day][slot] = [];
	}
	return { days, slots, cells };
}

/**
 * Fold parsed occurrences into a grid keyed by the supplied days/slots.
 * Occurrences whose day or slot don't match the canonical lists are dropped
 * from the grid (they still count for groceries via `parseMealPlanContents`).
 */
export function occurrencesToGrid(
	occurrences: readonly PlanOccurrence[],
	days: string[],
	slots: string[],
): MealPlanGrid {
	const grid = emptyGrid(days, slots);
	const dayLookup = new Map(days.map((d) => [d.toLowerCase(), d]));
	const slotLookup = new Map(slots.map((s) => [s.toLowerCase(), s]));
	for (const occ of occurrences) {
		const day = dayLookup.get(occ.day.trim().toLowerCase());
		const slot = slotLookup.get(occ.slot.trim().toLowerCase());
		if (!day || !slot) continue;
		grid.cells[day]?.[slot]?.push(occ.file);
	}
	return grid;
}

/**
 * Serialize a grid back into markdown. One list item per recipe occurrence
 * keeps duplicates intact and round-trips cleanly through the parser. Every
 * day heading is written (even empty) so the note reads like a weekly
 * template; empty slots are omitted.
 */
export function serializeMealPlanGrid(
	app: App,
	notePath: string,
	grid: MealPlanGrid,
	title: string,
): string {
	const lines: string[] = [MEAL_PLAN_MARKER, "", `# ${title}`, ""];
	for (const day of grid.days) {
		lines.push(`## ${day}`);
		for (const slot of grid.slots) {
			const files = grid.cells[day]?.[slot] ?? [];
			for (const file of files) {
				const link = app.fileManager.generateMarkdownLink(
					file,
					notePath,
				);
				lines.push(`- **${slot}**: ${link}`);
			}
		}
		lines.push("");
	}
	const body = trimEndText(lines.join("\n"));
	return `${body}\n`;
}
