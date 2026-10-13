import { test } from "node:test";
import assert from "node:assert/strict";
import {
	adoptItemIds,
	parseInventoryBody,
	parseInventoryItemLine,
	replaceInventoryBody,
	serializeInventoryBody,
} from "../src/parser/inventory";
import { InventoryItem, InventoryPageContent } from "../src/types";

function item(overrides: Partial<InventoryItem>): InventoryItem {
	return {
		id: "id-1",
		name: "Rice",
		quantity: 0,
		desiredQuantity: 0,
		unit: "",
		category: null,
		dateAdded: "2026-01-01T00:00:00.000Z",
		expirationDate: null,
		notes: null,
		tags: [],
		shopLinks: [],
		...overrides,
	};
}

const PAGE: InventoryPageContent = {
	preamble: "Kitchen staples, checked weekly.",
	sections: [
		{
			name: "Pantry",
			tags: ["shelf-stable"],
			items: [
				item({ id: "a", name: "Rice", quantity: 2, desiredQuantity: 5, unit: "lb", tags: ["grain"] }),
				item({
					id: "b",
					name: "Olive oil",
					quantity: 1.5,
					unit: "l",
					expirationDate: "2027-03-01",
					notes: "Top shelf",
					shopLinks: [{ nickname: "Safeway", url: "https://example.com/oil" }],
				}),
				item({ id: "c", name: "Salt" }),
			],
			extraLines: ["Restock before the holidays."],
		},
		{ name: "Freezer", tags: [], items: [item({ id: "d", name: "Peas", quantity: 3 })], extraLines: [] },
	],
};

test("serialize → parse → serialize is stable", () => {
	const text = serializeInventoryBody(PAGE);
	const parsed = parseInventoryBody(text);
	assert.deepEqual(parsed, PAGE);
	assert.equal(serializeInventoryBody(parsed), text);
});

test("hand-typed lines parse from visible text alone", () => {
	const rice = parseInventoryItemLine("- Rice (2/5 lb) #baking");
	assert.ok(rice);
	assert.equal(rice.name, "Rice");
	assert.equal(rice.quantity, 2);
	assert.equal(rice.desiredQuantity, 5);
	assert.equal(rice.unit, "lb");
	assert.deepEqual(rice.tags, ["baking"]);

	const salt = parseInventoryItemLine("- Salt");
	assert.ok(salt);
	assert.equal(salt.quantity, 0);
	assert.equal(salt.desiredQuantity, 0);

	assert.equal(parseInventoryItemLine("not a bullet"), null);
});

test("visible quantity wins over stale hidden metadata", () => {
	const parsed = parseInventoryItemLine('- Rice (7 lb) <!--pantry:{"id":"a","notes":"bin 2"}-->');
	assert.ok(parsed);
	assert.equal(parsed.id, "a");
	assert.equal(parsed.quantity, 7);
	assert.equal(parsed.notes, "bin 2");
});

test("bodies without headings fold into one implicit section", () => {
	const page = parseInventoryBody("- Rice\n- Beans\n");
	assert.equal(page.sections.length, 1);
	assert.equal(page.sections[0]?.name, "Items");
	assert.deepEqual(
		page.sections[0]?.items.map((i) => i.name),
		["Rice", "Beans"],
	);

	const empty = parseInventoryBody("");
	assert.equal(empty.sections.length, 1);
	assert.equal(empty.sections[0]?.items.length, 0);
});

test("replaceInventoryBody keeps frontmatter untouched", () => {
	const note = "---\ntype: inventory\ncustom: keep me\n---\n## Old\n- Gone\n";
	const out = replaceInventoryBody(note, PAGE);
	assert.ok(out.startsWith("---\ntype: inventory\ncustom: keep me\n---\n"));
	assert.ok(!out.includes("Gone"));
	assert.deepEqual(parseInventoryBody(out.split("---\n").slice(2).join("---\n")), PAGE);
});

test("adoptItemIds keeps ids stable for hand-typed lines across re-parses", () => {
	const body = "## Pantry\n- Rice (2)\n- Beans\n## Freezer\n- Rice\n";
	const first = parseInventoryBody(body);
	const second = parseInventoryBody(body.replace("(2)", "(3)"));
	adoptItemIds(second, first);

	const ids = (p: InventoryPageContent) => p.sections.flatMap((s) => s.items.map((i) => i.id));
	assert.deepEqual(ids(second), ids(first));
	assert.equal(second.sections[0]?.items[0]?.quantity, 3);
});
