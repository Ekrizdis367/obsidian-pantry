import { App, Modal, Notice, Setting } from "obsidian";
import { defaultImportFolder } from "../importer/note-builder";
import { parseRecipeText } from "../importer/text-parser";
import { saveImportedRecipe } from "../importer/writer";
import { PantrySettings } from "../settings";

export interface ImportTextHost {
	getSettings(): PantrySettings;
}

export class ImportTextModal extends Modal {
	private title = "";
	private body = "";
	private folder = "";

	constructor(
		app: App,
		private readonly host: ImportTextHost,
	) {
		super(app);
		this.folder = defaultImportFolder(host.getSettings());
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pantry-import-modal");
		this.titleEl.setText("Import recipe from text");

		new Setting(contentEl)
			.setName("Recipe title")
			.setDesc("Optional. Leave blank to use the first line of the text.")
			.addText((text) =>
				text
					.setPlaceholder("Weeknight chili")
					.onChange((value) => {
						this.title = value.trim();
					}),
			);

		new Setting(contentEl)
			.setName("Save to folder")
			.setDesc("Vault-relative folder for the new note.")
			.addText((text) =>
				text
					.setPlaceholder("Recipes")
					.setValue(this.folder)
					.onChange((value) => {
						this.folder = value.trim();
					}),
			);

		contentEl.createEl("p", {
			cls: "pantry-import-hint",
			text: "Paste the full recipe below. The importer looks for ingredient and instruction headings, and otherwise detects ingredient lines by their quantities.",
		});

		const textarea = contentEl.createEl("textarea", {
			cls: "pantry-import-textarea",
			attr: {
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- literal example of pasted recipe text
				placeholder: "Ingredients\n- 1 lb ground beef\n- 1 onion, diced\n\nInstructions\n1. Brown the beef.\n2. Add the onion and simmer.",
				rows: "14",
			},
		});
		textarea.addEventListener("input", () => {
			this.body = textarea.value;
		});

		const actions = contentEl.createDiv({ cls: "pantry-modal-actions" });
		actions
			.createEl("button", { text: "Cancel", attr: { type: "button" } })
			.addEventListener("click", () => this.close());

		const importBtn = actions.createEl("button", {
			text: "Import",
			cls: "mod-cta",
			attr: { type: "button" },
		});
		importBtn.addEventListener("click", () => {
			importBtn.disabled = true;
			void this.submit().finally(() => {
				importBtn.disabled = false;
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		if (!this.body.trim()) {
			new Notice("Please paste some recipe text.");
			return;
		}

		const recipe = parseRecipeText(this.body, this.title);
		if (
			recipe.ingredientLines.length === 0 &&
			recipe.instructionSteps.length === 0
		) {
			new Notice(
				"Couldn't find any ingredients or steps in that text. Add ingredient and instruction headings and try again.",
			);
			return;
		}

		const settings = this.host.getSettings();
		this.close();
		await saveImportedRecipe(this.app, recipe, settings, this.folder);
	}
}
