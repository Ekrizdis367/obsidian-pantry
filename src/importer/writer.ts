import { App, Notice, TFile } from "obsidian";
import { ConfirmModal } from "../ui/confirm-modal";
import { VIEW_TYPE_RECIPE } from "../ui/recipe-view";
import { PantrySettings } from "../settings";
import {
	buildRecipeNote,
	defaultImportFolder,
	ensureParentFolders,
	titleToFilename,
} from "./note-builder";
import { ImportedRecipe } from "./types";

/**
 * Build a normalized recipe note from extracted data and write it to the
 * vault, prompting before overwriting an existing file and opening the
 * result in the recipe view. Shared by the URL and text importers so both
 * produce identical notes and handle collisions the same way.
 */
export async function saveImportedRecipe(
	app: App,
	recipe: ImportedRecipe,
	settings: PantrySettings,
	folderOverride: string,
): Promise<void> {
	const content = await buildRecipeNote(app, recipe, settings);
	const filename = `${titleToFilename(recipe.title)}.md`;
	const folder = folderOverride.trim() || defaultImportFolder(settings);
	const notePath = folder ? `${folder}/${filename}` : filename;

	const existing = app.vault.getAbstractFileByPath(notePath);
	if (existing instanceof TFile) {
		new ConfirmModal(app, {
			title: "Note already exists",
			message: `"${filename}" already exists in ${folder || "the vault root"}. Overwrite it?`,
			confirmText: "Overwrite",
			destructive: true,
			onConfirm: () => writeAndOpen(app, notePath, content, true),
		}).open();
		return;
	}

	await writeAndOpen(app, notePath, content, false);
}

async function writeAndOpen(
	app: App,
	notePath: string,
	content: string,
	overwrite: boolean,
): Promise<void> {
	try {
		await ensureParentFolders(app, notePath);

		if (overwrite) {
			const file = app.vault.getAbstractFileByPath(notePath);
			if (file instanceof TFile) {
				await app.vault.modify(file, content);
			}
		} else {
			await app.vault.create(notePath, content);
		}

		new Notice(`Recipe imported: ${notePath.split("/").pop()}`);

		const file = app.vault.getAbstractFileByPath(notePath);
		if (file instanceof TFile) {
			const leaf = app.workspace.getLeaf(false);
			await leaf.setViewState({
				type: VIEW_TYPE_RECIPE,
				state: { file: file.path },
				active: true,
			});
			void app.workspace.revealLeaf(leaf);
		}
	} catch (err) {
		new Notice(`Import failed: ${String(err)}`);
	}
}
