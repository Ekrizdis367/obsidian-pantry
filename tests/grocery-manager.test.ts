import assert from "node:assert/strict";
import { test } from "node:test";
import { GroceryListManager } from "../src/grocery/manager";
import { ingredientKey } from "../src/parser/ingredient";
import { PantrySettings } from "../src/settings";
import { FakeVault, testSettings } from "./fake-vault";

const FLOUR = ingredientKey("flour", "cup");
const TAPE = ingredientKey("Tape", "");

const SOUP = `---
groceryList: true
---
## Ingredients
- 2 cups flour
`;

function settings(overrides: Partial<PantrySettings> = {}): PantrySettings {
	return testSettings({
		excludeInStockFromGrocery: false,
		recipeFolders: ["Recipes"],
		state: {
			oneOffs: [
				{
					id: "tape",
					name: "Tape",
					quantity: null,
					unit: "",
					category: null,
				},
			],
			checkedKeys: { [FLOUR]: true, [TAPE]: true },
			collapsedGroups: {},
		},
		...overrides,
	});
}

function loaded(vault: FakeVault, pantrySettings = settings()) {
	const saves: number[] = [];
	const manager = new GroceryListManager(vault.asApp(), {
		settings: pantrySettings,
		save: async () => {
			saves.push(1);
		},
		getInventoryItems: () => [],
	});
	return { manager, saves, pantrySettings };
}

test("a cold metadata cache does not uncheck recipe items", async () => {
	const vault = new FakeVault({ "Recipes/Soup.md": SOUP });
	vault.metadataReady = false;
	const { manager, saves, pantrySettings } = loaded(vault);

	await manager.refresh();

	assert.equal(pantrySettings.state.checkedKeys[FLOUR], true);
	assert.equal(pantrySettings.state.checkedKeys[TAPE], true);
	assert.equal(saves.length, 0);
	assert.equal(
		manager.getItems().some((item) => item.key === FLOUR),
		false,
	);

	vault.metadataReady = true;
	await manager.refresh();

	const flour = manager.getItems().find((item) => item.key === FLOUR);
	assert.equal(flour?.checked, true);
	assert.equal(pantrySettings.state.checkedKeys[FLOUR], true);
	assert.equal(pantrySettings.state.checkedKeys[TAPE], true);
	assert.equal(saves.length, 0);
});

test("a refresh requested during a cold scan runs again once the cache is ready", async () => {
	const vault = new FakeVault({ "Recipes/Soup.md": SOUP });
	vault.metadataReady = false;
	const { manager, pantrySettings } = loaded(vault);

	const pending = manager.refresh();
	vault.metadataReady = true;
	const again = manager.refresh();
	await pending;
	await again;

	const flour = manager.getItems().find((item) => item.key === FLOUR);
	assert.equal(flour?.checked, true);
	assert.equal(pantrySettings.state.checkedKeys[FLOUR], true);
});

test("unselecting a recipe still drops its checked items", async () => {
	const vault = new FakeVault({ "Recipes/Soup.md": SOUP });
	const { manager, saves, pantrySettings } = loaded(vault);

	await manager.refresh();
	assert.equal(
		manager.getItems().find((item) => item.key === FLOUR)?.checked,
		true,
	);

	vault.write(
		"Recipes/Soup.md",
		SOUP.replace("groceryList: true", "groceryList: false"),
	);
	await manager.refresh();

	assert.equal(pantrySettings.state.checkedKeys[FLOUR], undefined);
	assert.equal(pantrySettings.state.checkedKeys[TAPE], true);
	assert.equal(saves.length, 1);
	assert.equal(
		manager.getItems().some((item) => item.key === FLOUR),
		false,
	);
});

test("removing a one-off still drops its check after a complete scan", async () => {
	const vault = new FakeVault({ "Recipes/Soup.md": SOUP });
	const { manager, pantrySettings } = loaded(vault);

	await manager.refresh();
	await manager.removeOneOff("tape");

	assert.equal(pantrySettings.state.checkedKeys[TAPE], undefined);
	assert.equal(pantrySettings.state.checkedKeys[FLOUR], true);
	assert.equal(
		manager.getItems().find((item) => item.key === FLOUR)?.checked,
		true,
	);
});

test("a meal-plan link that has not resolved yet keeps recipe checks", async () => {
	const vault = new FakeVault({
		"Recipes/Soup.md": SOUP.replace("groceryList: true", "type: recipe"),
		"Plan.md": "---\ntype: plan\n---\n## Monday\n- Dinner: [[Soup]]\n",
	});
	vault.linksReady = false;
	const pantrySettings = settings({
		mealPlanEnabled: true,
		mealPlanNotePath: "Plan.md",
	});
	const { manager, saves } = loaded(vault, pantrySettings);

	await manager.refresh();

	assert.equal(pantrySettings.state.checkedKeys[FLOUR], true);
	assert.equal(saves.length, 0);
	assert.equal(
		manager.getItems().some((item) => item.key === FLOUR),
		false,
	);

	vault.linksReady = true;
	await manager.refresh();

	assert.equal(
		manager.getItems().find((item) => item.key === FLOUR)?.checked,
		true,
	);
	assert.equal(pantrySettings.state.checkedKeys[FLOUR], true);
});

test("a meal-plan link that is still missing after resolve drops its check", async () => {
	const vault = new FakeVault({
		"Recipes/Soup.md": "---\ntype: recipe\n---\n## Ingredients\n- 2 cups flour\n",
		"Plan.md": "---\ntype: plan\n---\n## Monday\n- Dinner: [[Missing]]\n",
	});
	vault.linksReady = false;
	const pantrySettings = settings({
		mealPlanEnabled: true,
		mealPlanNotePath: "Plan.md",
	});
	const { manager } = loaded(vault, pantrySettings);

	await manager.refresh();
	assert.equal(pantrySettings.state.checkedKeys[FLOUR], true);

	manager.markCacheResolved();
	await manager.refresh();

	assert.equal(pantrySettings.state.checkedKeys[FLOUR], undefined);
	assert.equal(pantrySettings.state.checkedKeys[TAPE], true);
});
