import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildLegacyMigrationSections,
	legacyInventoryBackupPath,
	normalizeInventoryItems,
	parseInventoryState,
	serializeInventoryState,
} from "../src/grocery/inventory-state";
import { parseInventoryBody, serializeInventoryBody } from "../src/parser/inventory";

const LEGACY_ITEMS = [
	{ id: "1", name: "Flour", inStock: true, unit: "kg", category: "Baking", tags: ["staple"] },
	{ id: "2", name: "Sugar", inStock: false, category: "Baking" },
	{ id: "3", name: "Garlic powder" },
	{ name: "No id, dropped" },
	"garbage",
];

test("normalizeInventoryItems maps the legacy inStock flag onto quantities", () => {
	const items = normalizeInventoryItems(LEGACY_ITEMS);
	assert.deepEqual(
		items.map((i) => [i.id, i.quantity, i.desiredQuantity]),
		[
			["1", 1, 0],
			["2", 0, 0],
			// Missing flag meant "in stock" in 1.3.x.
			["3", 1, 0],
		],
	);
	assert.equal(normalizeInventoryItems(undefined).length, 0);
});

test("legacy items group into sections by old category and survive a page round-trip", () => {
	const sections = buildLegacyMigrationSections(normalizeInventoryItems(LEGACY_ITEMS), new Set());
	assert.deepEqual(
		sections.map((s) => [s.name, s.items.map((i) => i.name)]),
		[
			["Baking", ["Flour", "Sugar"]],
			["Items", ["Garlic powder"]],
		],
	);
	assert.ok(sections.every((s) => s.items.every((i) => i.category === null)));

	const page = parseInventoryBody(serializeInventoryBody({ preamble: "", sections }));
	assert.deepEqual(page.sections, sections);
});

test("ids already living in a page are skipped, so re-runs never duplicate", () => {
	const items = normalizeInventoryItems(LEGACY_ITEMS);
	const sections = buildLegacyMigrationSections(items, new Set(["1", "2"]));
	assert.deepEqual(
		sections.map((s) => s.items.map((i) => i.id)),
		[["3"]],
	);
	assert.equal(buildLegacyMigrationSections(items, new Set(["1", "2", "3"])).length, 0);
});

test("rewriting the state file drops legacy items but keeps view state", () => {
	const legacyJson = JSON.stringify({
		version: 1,
		items: LEGACY_ITEMS,
		groupBy: "tag",
		filterTags: ["staple"],
	});
	const state = parseInventoryState(legacyJson);
	assert.ok(state);
	const rewritten = JSON.parse(serializeInventoryState(state)) as Record<string, unknown>;
	assert.equal(rewritten.items, undefined);
	assert.equal(rewritten.groupBy, "tag");
	assert.deepEqual(rewritten.filterTags, ["staple"]);
});

test("backup path sits beside the state file", () => {
	assert.equal(
		legacyInventoryBackupPath("Pantry/inventory-state.json"),
		"Pantry/inventory-state.legacy-backup.json",
	);
	assert.equal(legacyInventoryBackupPath(""), "Pantry/inventory-state.legacy-backup.json");
});
