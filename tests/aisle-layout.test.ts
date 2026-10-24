import { test } from "node:test";
import assert from "node:assert/strict";
import {
	aisleParentOf,
	applyEffectiveAisle,
	categoryWalkOrder,
	formatCategoryLines,
	mergeAisleShop,
	parseAisleLayout,
	parseCategoryLines,
	serializeAisleLayout,
} from "../src/grocery/aisle-layout";
import { DEFAULT_SETTINGS, PantrySettings } from "../src/settings";

test("parseCategoryLines nests a child and creates its parent", () => {
	const categories = parseCategoryLines("Produce\nProduce / Fruit\nBakery");
	assert.deepEqual(categories, [
		{ name: "Produce" },
		{ name: "Fruit", parent: "Produce" },
		{ name: "Bakery" },
	]);
	assert.equal(formatCategoryLines(categories), "Produce\nProduce / Fruit\nBakery");
});

test("a child whose parent line is missing still gains that parent", () => {
	const categories = parseCategoryLines("Produce / Fruit");
	assert.deepEqual(categories, [
		{ name: "Produce" },
		{ name: "Fruit", parent: "Produce" },
	]);
	assert.equal(aisleParentOf(categories, "Fruit"), "Produce");
	assert.equal(aisleParentOf(categories, "Produce"), null);
});

test("walk order places each child after its parent", () => {
	const categories = parseCategoryLines("Produce / Fruit\nBakery\nProduce");
	assert.deepEqual(categoryWalkOrder(categories), ["Produce", "Fruit", "Bakery"]);
});

test("local aisles append and a local override replaces the same match", () => {
	const merged = mergeAisleShop(
		{
			categories: [{ name: "Produce" }],
			overrides: [
				{ match: "banana", category: "Produce" },
				{ match: "soap", category: "Household" },
			],
		},
		{
			categories: [
				{ name: "Produce" },
				{ name: "Checkout" },
			],
			overrides: [{ match: "banana", category: "Fruit" }],
		},
	);
	assert.deepEqual(
		merged.categories.map((category) => category.name),
		["Produce", "Checkout"],
	);
	assert.deepEqual(merged.overrides, [
		{ match: "banana", category: "Fruit" },
		{ match: "soap", category: "Household" },
	]);
});

test("the layout file round-trips and apply uses the active shop plus local additions", () => {
	const layout = parseAisleLayout(
		serializeAisleLayout({
			shops: {
				Costco: {
					categories: parseCategoryLines("Produce\nProduce / Fruit"),
					overrides: [{ match: "soap", category: "Household" }],
				},
			},
		}),
	);
	assert.ok(layout);
	const settings: PantrySettings = {
		...DEFAULT_SETTINGS,
		activeShop: "Costco",
		aisleLayout: layout,
		aisleLocal: {
			shops: {
				Costco: {
					categories: [{ name: "Checkout" }],
					overrides: [{ match: "banana", category: "Fruit" }],
				},
			},
		},
	};
	applyEffectiveAisle(settings);
	assert.deepEqual(settings.categoryOrder, ["Produce", "Fruit", "Checkout"]);
	assert.deepEqual(settings.categoryOverrides, [
		{ match: "banana", category: "Fruit" },
		{ match: "soap", category: "Household" },
	]);
	assert.equal(aisleParentOf(settings.aisleCategories, "Fruit"), "Produce");
});

test("a broken layout file is rejected", () => {
	assert.equal(parseAisleLayout("{"), null);
	assert.deepEqual(parseAisleLayout(""), { shops: {} });
});
