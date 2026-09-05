import { Notice, Plugin, TFile } from "obsidian";
import { GroceryListManager } from "../grocery/manager";
import { setRecipeSelection } from "../grocery/selection";
import { isRecipeSelected } from "../parser/recipe";
import { PantrySettings } from "../settings";
import { AddOneOffModal } from "../ui/add-item-modal";
import { ExportListModal } from "../ui/export-modal";
import { ImportRecipeModal } from "../ui/import-recipe-modal";
import { ImportTextModal } from "../ui/import-text-modal";
import { LeaderboardModal } from "../ui/leaderboard-modal";
import {
	importMealPlanNote,
	MealPlanPickerModal,
} from "../ui/meal-plan-picker";
import {
	formatAutoFillNotice,
	runAutoFillWeek,
} from "../grocery/meal-plan-fill";
import { SuggestMealModal } from "../ui/suggest-modal";
import { MealPlannerView, VIEW_TYPE_MEAL_PLANNER } from "../ui/planner-view";

export interface CommandsHost {
	plugin: Plugin;
	manager: GroceryListManager;
	settings: PantrySettings;
	saveSettings(): Promise<void>;
	openView(): Promise<void>;
	openMealPlanner(): Promise<void>;
	openInventory(): Promise<void>;
	openCurrentAsRecipe(): Promise<void>;
	openCurrentAsMarkdown(): Promise<void>;
}

export function registerCommands(host: CommandsHost): void {
	const { plugin, manager } = host;

	plugin.addCommand({
		id: "open-grocery-list",
		name: "Open grocery list",
		callback: () => {
			void host.openView();
		},
	});

	plugin.addCommand({
		id: "open-inventory",
		name: "Open inventory",
		callback: () => {
			void host.openInventory();
		},
	});

	plugin.addCommand({
		id: "refresh-grocery-list",
		name: "Refresh grocery list from recipes",
		callback: async () => {
			await manager.refresh();
			new Notice("Grocery list refreshed.");
		},
	});

	plugin.addCommand({
		id: "clear-grocery-list",
		name: "Clear grocery list",
		callback: async () => {
			await manager.clearAll();
		},
	});

	plugin.addCommand({
		id: "reset-grocery-checks",
		name: "Reset grocery list checks",
		callback: async () => {
			await manager.resetChecks();
			new Notice("Grocery list checks reset.");
		},
	});

	plugin.addCommand({
		id: "add-one-off-item",
		name: "Add one-off grocery item",
		callback: () => {
			new AddOneOffModal(plugin.app, manager).open();
		},
	});

	plugin.addCommand({
		id: "open-meal-planner",
		name: "Open meal planner",
		callback: () => {
			void host.openMealPlanner();
		},
	});

	plugin.addCommand({
		id: "auto-fill-meal-planner",
		name: "Auto-fill empty meal planner slots",
		callback: async () => {
			const result = await runAutoFillWeek(plugin.app, {
				getSettings: () => host.settings,
				saveSettings: () => host.saveSettings(),
				manager,
			});
			for (const leaf of plugin.app.workspace.getLeavesOfType(
				VIEW_TYPE_MEAL_PLANNER,
			)) {
				const view = leaf.view;
				if (view instanceof MealPlannerView) {
					await view.reloadFromDisk();
				}
			}
			new Notice(formatAutoFillNotice(result));
		},
	});

	plugin.addCommand({
		id: "import-meal-plan",
		name: "Import meal plan into shopping list",
		callback: () => {
			const file = plugin.app.workspace.getActiveFile();
			if (file instanceof TFile && file.extension === "md") {
				void importMealPlanNote(manager, file);
			} else {
				new MealPlanPickerModal(plugin.app, manager).open();
			}
		},
	});

	plugin.addCommand({
		id: "toggle-recipe-selection",
		name: "Toggle this recipe in the grocery list",
		checkCallback: (checking) => {
			const file = plugin.app.workspace.getActiveFile();
			if (!(file instanceof TFile) || file.extension !== "md") {
				return false;
			}
			if (checking) return true;
			void toggleRecipeSelection(host, file);
			return true;
		},
	});

	plugin.addCommand({
		id: "open-as-recipe",
		name: "Open as recipe",
		checkCallback: (checking) => {
			const file = plugin.app.workspace.getActiveFile();
			if (!(file instanceof TFile) || file.extension !== "md") {
				return false;
			}
			if (checking) return true;
			void host.openCurrentAsRecipe();
			return true;
		},
	});

	plugin.addCommand({
		id: "open-as-markdown",
		name: "Open as Markdown",
		checkCallback: (checking) => {
			const file = plugin.app.workspace.getActiveFile();
			if (!(file instanceof TFile) || file.extension !== "md") {
				return false;
			}
			if (checking) return true;
			void host.openCurrentAsMarkdown();
			return true;
		},
	});

	plugin.addCommand({
		id: "suggest-meal",
		name: "Suggest a meal",
		callback: () => {
			new SuggestMealModal(plugin.app, {
				getSettings: () => host.settings,
				manager,
			}).open();
		},
	});

	plugin.addCommand({
		id: "show-cooking-stats",
		name: "Show cooking stats",
		callback: () => {
			new LeaderboardModal(plugin.app, {
				getSettings: () => host.settings,
			}).open();
		},
	});

	plugin.addCommand({
		id: "export-grocery-list",
		name: "Export grocery list",
		callback: () => {
			new ExportListModal(plugin.app, {
				getSettings: () => host.settings,
				manager,
			}).open();
		},
	});

	plugin.addCommand({
		id: "import-recipe",
		name: "Import recipe from URL",
		callback: () => {
			new ImportRecipeModal(plugin.app, {
				getSettings: () => host.settings,
			}).open();
		},
	});

	plugin.addCommand({
		id: "import-recipe-text",
		name: "Import recipe from text",
		callback: () => {
			new ImportTextModal(plugin.app, {
				getSettings: () => host.settings,
			}).open();
		},
	});
}

async function toggleRecipeSelection(
	host: CommandsHost,
	file: TFile,
): Promise<void> {
	const cache = host.plugin.app.metadataCache.getFileCache(file);
	const currentlySelected = isRecipeSelected(
		cache,
		host.settings.selectionProperty,
	);
	const next = !currentlySelected;
	await setRecipeSelection(host.plugin.app, file, next, host.settings);
	new Notice(
		`${file.basename} ${next ? "added to" : "removed from"} grocery list.`,
	);
	await host.manager.refresh();
}
