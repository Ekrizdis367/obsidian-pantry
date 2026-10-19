import { App } from "obsidian";
import { InventoryManager } from "./inventory-manager";
import {
	buildLegacyMigrationSections,
	LegacyInventory,
	legacyInventoryBackupPath,
} from "./inventory-state";

export interface LegacyImportResult {
	importedCount: number;
	/** Page the items were written to, or null when every item was already imported. */
	pagePath: string | null;
	backupPath: string;
}

/**
 * Import leftover pre-file-based items into a new inventory page and archive
 * the original JSON beside the state file. Items whose id already lives in
 * a page are skipped, so re-running (another synced device, a retry after a
 * failure) never duplicates anything. Throws on failure; the caller decides
 * whether the state file may be rewritten.
 */
export async function importLegacyInventory(
	app: App,
	manager: InventoryManager,
	legacy: LegacyInventory,
	options: { statePath: string; folder: string },
): Promise<LegacyImportResult> {
	await manager.refresh();
	const existingIds = new Set(manager.getEntries().map((e) => e.item.id));
	const sections = buildLegacyMigrationSections(legacy.items, existingIds);
	const importedCount = sections.reduce((n, s) => n + s.items.length, 0);

	let pagePath: string | null = null;
	if (sections.length > 0) {
		const file = await manager.createPageWithSections("Inventory", options.folder, sections);
		pagePath = file.path;
	}

	const backupPath = legacyInventoryBackupPath(options.statePath);
	if (!app.vault.getAbstractFileByPath(backupPath)) {
		await app.vault.create(backupPath, legacy.raw);
	}
	return { importedCount, pagePath, backupPath };
}
