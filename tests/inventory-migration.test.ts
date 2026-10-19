import { test } from "node:test";
import assert from "node:assert/strict";
import { importLegacyInventory } from "../src/grocery/inventory-migration";
import {
	buildLegacyMigrationSections,
	legacyInventoryBackupPath,
	normalizeInventoryItems,
	parseInventoryState,
	readLegacyInventory,
	serializeInventoryState,
} from "../src/grocery/inventory-state";
import { parseInventoryBody, serializeInventoryBody, splitFrontmatter } from "../src/parser/inventory";
import { FakeVault, loadedManager } from "./fake-vault";

const STATE_PATH = "Pantry/inventory-state.json";
const OPTIONS = { statePath: STATE_PATH, folder: "Pantry" };

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

const LEGACY_JSON = JSON.stringify({ version: 1, items: LEGACY_ITEMS, groupBy: "flat" });

test("readLegacyInventory only reports files that still carry items", async () => {
	const legacy = await readLegacyInventory(new FakeVault({ [STATE_PATH]: LEGACY_JSON }).asApp(), STATE_PATH);
	assert.deepEqual(legacy?.items.map((i) => i.id), ["1", "2", "3"]);
	assert.equal(legacy?.raw, LEGACY_JSON);

	const current = new FakeVault({ [STATE_PATH]: serializeInventoryState(parseInventoryState("{}") ?? assert.fail()) });
	assert.equal(await readLegacyInventory(current.asApp(), STATE_PATH), null);
	assert.equal(await readLegacyInventory(new FakeVault({ [STATE_PATH]: "not json" }).asApp(), STATE_PATH), null);
	assert.equal(await readLegacyInventory(new FakeVault().asApp(), STATE_PATH), null);
});

test("import with no pages yet creates a page and backs up the original JSON", async () => {
	const vault = new FakeVault({ [STATE_PATH]: LEGACY_JSON });
	const manager = await loadedManager(vault);
	const legacy = await readLegacyInventory(vault.asApp(), STATE_PATH);
	assert.ok(legacy);

	const result = await importLegacyInventory(vault.asApp(), manager, legacy, OPTIONS);

	assert.deepEqual(result, {
		importedCount: 3,
		pagePath: "Pantry/Inventory.md",
		backupPath: "Pantry/inventory-state.legacy-backup.json",
	});
	assert.equal(vault.content(result.backupPath), LEGACY_JSON);
	const page = parseInventoryBody(splitFrontmatter(vault.content("Pantry/Inventory.md") ?? "").body);
	assert.deepEqual(
		page.sections.map((s) => [s.name, s.items.map((i) => [i.name, i.quantity])]),
		[
			["Baking", [["Flour", 1], ["Sugar", 0]]],
			["Items", [["Garlic powder", 1]]],
		],
	);
	assert.equal(manager.getEntries().length, 3, "new page is live in the manager");
});

test("import alongside existing pages skips already-present ids and leaves those pages alone", async () => {
	const existing = '---\ntype: inventory\n---\n## Shelf\n- Flour (4 kg) <!--pantry:{"id":"1"}-->\n';
	const vault = new FakeVault({
		[STATE_PATH]: LEGACY_JSON,
		"Pantry/Inventory.md": existing,
	});
	const manager = await loadedManager(vault);
	const legacy = await readLegacyInventory(vault.asApp(), STATE_PATH);
	assert.ok(legacy);

	const result = await importLegacyInventory(vault.asApp(), manager, legacy, OPTIONS);

	assert.equal(result.importedCount, 2);
	assert.equal(result.pagePath, "Pantry/Inventory 2.md");
	assert.equal(vault.content("Pantry/Inventory.md"), existing);
	assert.deepEqual(
		manager.getEntries().map((e) => e.item.id).sort(),
		["1", "2", "3"],
	);
});

test("re-running an import creates nothing new and keeps the first backup", async () => {
	const vault = new FakeVault({ [STATE_PATH]: LEGACY_JSON });
	const manager = await loadedManager(vault);
	const legacy = await readLegacyInventory(vault.asApp(), STATE_PATH);
	assert.ok(legacy);

	await importLegacyInventory(vault.asApp(), manager, legacy, OPTIONS);
	const filesAfterFirst = vault.paths();
	const second = await importLegacyInventory(vault.asApp(), manager, { ...legacy, raw: "changed" }, OPTIONS);

	assert.equal(second.importedCount, 0);
	assert.equal(second.pagePath, null);
	assert.deepEqual(vault.paths(), filesAfterFirst);
	assert.equal(vault.content(second.backupPath), LEGACY_JSON);
});
