import { test } from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";
import {
	emptyGrid,
	occurrencesToGrid,
	parseMealPlanContents,
	serializeMealPlanGrid,
} from "../src/parser/meal-plan";
import { PantrySettings } from "../src/settings";

const app = {
	metadataCache: {
		getFirstLinkpathDest: () => null,
	},
	fileManager: {
		generateMarkdownLink: () => {
			throw new Error("notes do not need a wikilink");
		},
	},
} as unknown as App;

const settings = { recipeFolders: [] } as unknown as PantrySettings;

test("a slot line with no wikilink is a note and survives a save", () => {
	const source = [
		"%% pantry-meal-plan %%",
		"",
		"# Week",
		"",
		"## Monday",
		"- **Dinner**: Going out to X",
		"",
	].join("\n");
	const parsed = parseMealPlanContents(app, "Pantry/meal-plan.md", source, settings);
	assert.deepEqual(parsed.unresolved, []);
	assert.equal(parsed.occurrences.length, 1);
	assert.equal(parsed.occurrences[0]?.file, null);
	assert.equal(parsed.occurrences[0]?.note, "Going out to X");
	assert.equal(parsed.occurrences[0]?.day, "Monday");
	assert.equal(parsed.occurrences[0]?.slot, "Dinner");

	const grid = occurrencesToGrid(parsed.occurrences, ["Monday"], ["Dinner"]);
	const saved = serializeMealPlanGrid(app, "Pantry/meal-plan.md", grid, "Week");
	assert.match(saved, /- \*\*Dinner\*\*: Going out to X/);
	const again = parseMealPlanContents(app, "Pantry/meal-plan.md", saved, settings);
	assert.equal(again.occurrences[0]?.note, "Going out to X");
	assert.equal(again.occurrences[0]?.file, null);
});

test("an unresolved wikilink stays unresolved instead of becoming a note", () => {
	const parsed = parseMealPlanContents(
		app,
		"Pantry/meal-plan.md",
		"## Monday\n- **Dinner**: [[Missing recipe]]\n",
		settings,
	);
	assert.deepEqual(parsed.unresolved, ["Missing recipe"]);
	assert.equal(parsed.occurrences.length, 0);
});

test("an empty slot stays empty so auto-fill can use it", () => {
	const grid = emptyGrid(["Monday"], ["Dinner"]);
	const monday = grid.cells.Monday;
	assert.ok(monday);
	assert.deepEqual(monday.Dinner, []);
});
