import { App, TFile } from "obsidian";
import { fileInRecipeFolders } from "./recipe";
import {
	MEAL_PLAN_MARKER,
	PantrySettings,
} from "../settings";
import { trimEndText } from "../utils/text";

/**
 * A single meal inside a meal-plan note. A recipe wikilink contributes its
 * ingredients once per appearance. A line with no wikilink is a free-text
 * note (eating out, leftovers) and never joins the grocery list.
 */
export interface PlanOccurrence {
	/** Recipe note, when this occurrence is a wikilink into the recipe folders. */
	file: TFile | null;
	/** Free-text meal, when this occurrence is not a recipe. */
	note: string | null;
	/** The `## ` heading the entry appeared under (e.g. "Monday"); "" when none. */
	day: string;
	/** The meal label the entry appeared under (e.g. "Dinner"); "" when none. */
	slot: string;
}

/** One cell entry in the planner grid: a recipe file or a text note. */
export type MealPlanEntry =
	| { kind: "recipe"; file: TFile }
	| { kind: "note"; text: string };

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
 * the current meal label. Wikilinks that resolve to a markdown file in the
 * recipe folders become recipe occurrences. A slot line with no wikilink
 * becomes a note. Links that don't resolve are surfaced via `unresolved`.
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

		let body = "";
		let isList = false;
		const labelled = line.match(SLOT_LABEL_RE);
		if (labelled) {
			currentSlot = (labelled[1] ?? "").trim();
			body = labelled[2] ?? "";
			isList = true;
		} else {
			const item = line.match(LIST_ITEM_RE);
			if (item) {
				body = item[1] ?? "";
				isList = true;
			}
		}
		if (!isList) continue;

		const links = extractWikilinks(body);
		for (const link of links) {
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
					note: null,
					day: currentDay,
					slot: currentSlot,
				});
			} else {
				unresolved.push(link);
			}
		}
		if (links.length === 0) {
			const text = body.trim();
			if (text) {
				occurrences.push({
					file: null,
					note: text,
					day: currentDay,
					slot: currentSlot,
				});
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

/** A planner grid: ordered days, each mapping a slot to its meals. */
export interface MealPlanGrid {
	days: string[];
	slots: string[];
	/** cells[day][slot] = meals in insertion order (duplicate recipes allowed). */
	cells: Record<string, Record<string, MealPlanEntry[]>>;
}

/** Build an empty grid for the given days and slots. */
export function emptyGrid(days: string[], slots: string[]): MealPlanGrid {
	const cells: Record<string, Record<string, MealPlanEntry[]>> = {};
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
		const cell = grid.cells[day]?.[slot];
		if (!cell) continue;
		if (occ.file) cell.push({ kind: "recipe", file: occ.file });
		else if (occ.note) cell.push({ kind: "note", text: occ.note });
	}
	return grid;
}

/**
 * Serialize a grid back into markdown. One list item per meal keeps
 * duplicates intact and round-trips through the parser. Recipes are
 * wikilinks; notes are plain text on the same line. Every day heading is
 * written (even empty) so the note reads like a weekly template; empty
 * slots are omitted.
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
			const entries = grid.cells[day]?.[slot] ?? [];
			for (const entry of entries) {
				if (entry.kind === "recipe") {
					const link = app.fileManager.generateMarkdownLink(
						entry.file,
						notePath,
					);
					lines.push(`- **${slot}**: ${link}`);
				} else {
					const text = entry.text.replace(/\s+/g, " ").trim();
					if (text) lines.push(`- **${slot}**: ${text}`);
				}
			}
		}
		lines.push("");
	}
	const body = trimEndText(lines.join("\n"));
	return `${body}\n`;
}
