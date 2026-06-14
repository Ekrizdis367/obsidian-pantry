import { App, FuzzySuggestModal, Notice, TFile } from "obsidian";
import { GroceryListManager } from "../grocery/manager";
import { collectMarkdownFiles } from "../utils/vault-files";

/**
 * Fuzzy picker over every markdown note in the vault. Selecting a note adopts
 * it as the active meal plan and imports its linked recipes into the grocery
 * list.
 */
export class MealPlanPickerModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly manager: GroceryListManager,
	) {
		super(app);
		this.setPlaceholder("Pick a meal-plan note to import…");
	}

	getItems(): TFile[] {
		return collectMarkdownFiles(this.app.vault.getRoot()).sort((a, b) =>
			a.path.localeCompare(b.path, undefined, { sensitivity: "base" }),
		);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		void importMealPlanNote(this.manager, file);
	}
}

/** Adopt a note as the active meal plan and report the result via a Notice. */
export async function importMealPlanNote(
	manager: GroceryListManager,
	file: TFile,
): Promise<void> {
	const result = await manager.adoptMealPlan(file);
	if (result.occurrences === 0) {
		new Notice(
			`No recipe links found in "${file.basename}". Nothing imported.`,
		);
		return;
	}
	const unresolvedNote =
		result.unresolved > 0
			? ` (${result.unresolved} link${result.unresolved === 1 ? "" : "s"} couldn't be resolved)`
			: "";
	new Notice(
		`Imported ${result.recipes} recipe${result.recipes === 1 ? "" : "s"} (${result.occurrences} meal${result.occurrences === 1 ? "" : "s"}) from "${file.basename}".${unresolvedNote}`,
	);
}
