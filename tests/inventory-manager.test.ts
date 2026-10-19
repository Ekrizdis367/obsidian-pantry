import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInventoryBody, splitFrontmatter } from "../src/parser/inventory";
import { InventoryPageContent } from "../src/types";
import { FakeVault, loadedManager } from "./fake-vault";

const FM = "---\ntype: inventory\nowner: kitchen\n---\n";
const PANTRY = `${FM}## Shelf #dry
- Rice (2/5 lb) <!--pantry:{"id":"rice"}-->
- Beans <!--pantry:{"id":"beans"}-->
Note under the shelf.
## Fridge
- Milk (1) <!--pantry:{"id":"milk"}-->
`;
const FREEZER = `${FM}## Drawer
- Peas (3) <!--pantry:{"id":"peas"}-->
`;

function onDisk(vault: FakeVault, path: string): InventoryPageContent {
	return parseInventoryBody(splitFrontmatter(vault.content(path) ?? "").body);
}

function findOnDisk(vault: FakeVault, path: string, id: string) {
	for (const section of onDisk(vault, path).sections) {
		const item = section.items.find((i) => i.id === id);
		if (item) return { section: section.name, item };
	}
	return null;
}

test("only notes with the inventory type are loaded as pages", async () => {
	const vault = new FakeVault({
		"Pantry.md": PANTRY,
		"Recipe.md": "---\ntype: recipe\n---\n- Rice\n",
		"Plain.md": "- Rice\n",
	});
	const manager = await loadedManager(vault);
	assert.deepEqual(
		manager.getPages().map((p) => p.file.path),
		["Pantry.md"],
	);
});

test("rapid concurrent nudges all land instead of overwriting each other", async () => {
	const vault = new FakeVault({ "Pantry.md": PANTRY });
	const manager = await loadedManager(vault);

	await Promise.all(
		Array.from({ length: 10 }, () => manager.adjustItemQuantity("Pantry.md", "rice", "quantity", 1)),
	);
	await Promise.all([
		manager.adjustItemQuantity("Pantry.md", "rice", "desiredQuantity", 1),
		manager.adjustItemQuantity("Pantry.md", "milk", "quantity", -5),
	]);

	assert.equal(findOnDisk(vault, "Pantry.md", "rice")?.item.quantity, 12);
	assert.equal(findOnDisk(vault, "Pantry.md", "rice")?.item.desiredQuantity, 6);
	assert.equal(findOnDisk(vault, "Pantry.md", "milk")?.item.quantity, 0, "clamped at zero");
	assert.equal(
		manager.getEntries().find((e) => e.item.id === "rice")?.item.quantity,
		12,
		"cache matches disk",
	);
});

test("writes merge into the latest file content, keeping external edits and frontmatter", async () => {
	const vault = new FakeVault({ "Pantry.md": PANTRY });
	const manager = await loadedManager(vault);

	vault.write("Pantry.md", PANTRY.replace("- Milk (1)", "- Milk (4)").concat("- Eggs (12)\n"));
	await manager.adjustItemQuantity("Pantry.md", "rice", "quantity", 1);

	const content = vault.content("Pantry.md") ?? "";
	assert.ok(content.startsWith(FM), "frontmatter untouched");
	assert.ok(content.includes("Note under the shelf."), "free text preserved");
	assert.equal(findOnDisk(vault, "Pantry.md", "rice")?.item.quantity, 3);
	assert.equal(findOnDisk(vault, "Pantry.md", "milk")?.item.quantity, 4, "external edit kept");
	assert.ok(
		onDisk(vault, "Pantry.md").sections[1]?.items.some((i) => i.name === "Eggs"),
		"externally added item kept",
	);
});

test("hand-typed items keep the id the UI holds across writes", async () => {
	const vault = new FakeVault({ "Pantry.md": `${FM}## Shelf\n- Oats (1)\n- Flour\n` });
	const manager = await loadedManager(vault);
	const oatsId = manager.getEntries().find((e) => e.item.name === "Oats")?.item.id ?? "";

	await manager.adjustItemQuantity("Pantry.md", oatsId, "quantity", 1);
	await manager.adjustItemQuantity("Pantry.md", oatsId, "quantity", 1);

	assert.equal(findOnDisk(vault, "Pantry.md", oatsId)?.item.quantity, 3);
	await manager.refresh();
	assert.ok(manager.getEntries().some((e) => e.item.id === oatsId));
});

test("moving across pages keeps every field and removes the source copy", async () => {
	const vault = new FakeVault({ "Pantry.md": PANTRY, "Freezer.md": FREEZER });
	const manager = await loadedManager(vault);

	await manager.moveItemToPage("Pantry.md", "rice", "Freezer.md", "Bags");

	assert.equal(findOnDisk(vault, "Pantry.md", "rice"), null);
	const moved = findOnDisk(vault, "Freezer.md", "rice");
	assert.equal(moved?.section, "Bags", "missing section is created");
	assert.equal(moved?.item.quantity, 2);
	assert.equal(moved?.item.desiredQuantity, 5);
	assert.equal(moved?.item.unit, "lb");
	assert.equal(manager.getEntries().filter((e) => e.item.id === "rice").length, 1);
});

test("moving within a page re-sections, and onto its own section is a no-op", async () => {
	const vault = new FakeVault({ "Pantry.md": PANTRY });
	const manager = await loadedManager(vault);

	await manager.moveItemToPage("Pantry.md", "beans", "Pantry.md", "Fridge");
	assert.equal(findOnDisk(vault, "Pantry.md", "beans")?.section, "Fridge");

	const before = vault.content("Pantry.md");
	await manager.moveItem("Pantry.md", "beans", "Fridge");
	assert.equal(vault.content("Pantry.md"), before);
});

test("a page always keeps one section, and removed sections hand their items on", async () => {
	const vault = new FakeVault({ "Pantry.md": PANTRY, "Freezer.md": FREEZER });
	const manager = await loadedManager(vault);

	assert.equal(await manager.removeSection("Freezer.md", "Drawer"), false);
	assert.ok(findOnDisk(vault, "Freezer.md", "peas"));

	assert.equal(await manager.removeSection("Pantry.md", "Fridge"), true);
	assert.equal(findOnDisk(vault, "Pantry.md", "milk")?.section, "Shelf");
});

test("adding and renaming sections, and removing items", async () => {
	const vault = new FakeVault({ "Pantry.md": PANTRY });
	const manager = await loadedManager(vault);

	await manager.addSection("Pantry.md", "shelf", []);
	assert.equal(onDisk(vault, "Pantry.md").sections.length, 2, "case-insensitive duplicate ignored");

	await manager.updateSection("Pantry.md", "Fridge", { name: "Cold", tags: ["chilled"] });
	const cold = onDisk(vault, "Pantry.md").sections[1];
	assert.equal(cold?.name, "Cold");
	assert.deepEqual(cold?.tags, ["chilled"]);

	await manager.removeItem("Pantry.md", "beans");
	assert.equal(findOnDisk(vault, "Pantry.md", "beans"), null);
});

test("a failed write rejects without blocking later writes to the same page", async () => {
	const vault = new FakeVault({ "Pantry.md": PANTRY });
	const manager = await loadedManager(vault);

	await assert.rejects(manager.adjustItemQuantity("Missing.md", "rice", "quantity", 1), /Unknown inventory page/);
	await assert.rejects(
		manager.updateItem("Pantry.md", "rice", {
			get quantity(): number {
				throw new Error("boom");
			},
		}),
		/boom/,
	);
	await manager.adjustItemQuantity("Pantry.md", "rice", "quantity", 1);
	assert.equal(findOnDisk(vault, "Pantry.md", "rice")?.item.quantity, 3);
});

test("new pages get a unique name and are immediately usable", async () => {
	const vault = new FakeVault({ "Kitchen/Dry goods.md": PANTRY });
	const manager = await loadedManager(vault);

	const file = await manager.createPage("Dry goods", "Kitchen/", "Shelf");
	assert.equal(file.path, "Kitchen/Dry goods 2.md");
	const template = manager.getEntries()[0]?.item;
	assert.ok(template);
	await manager.addItem(file.path, "Shelf", { ...template, id: "copy" });
	assert.equal(findOnDisk(vault, file.path, "copy")?.section, "Shelf");
	assert.ok((vault.content(file.path) ?? "").startsWith("---\ntype: inventory\n---\n"));
});
