import { App, TFile } from "obsidian";
import { frontmatterValueMatches } from "../parser/recipe";
import {
	parseInventoryBody,
	serializeInventoryBody,
	splitFrontmatter,
} from "../parser/inventory";
import { PantrySettings } from "../settings";
import { InventoryPageContent, InventorySection } from "../types";
import { listMarkdownFilesInFolders } from "../utils/vault-files";

/** Does a note's inventory-type frontmatter value match the configured target? */
export function inventoryTypeMatches(fmValue: unknown, target: string): boolean {
	return frontmatterValueMatches(fmValue, target);
}

/** All markdown files recognised as inventory pages: right folder + right frontmatter type. */
export function listInventoryFiles(app: App, settings: PantrySettings): TFile[] {
	const target = settings.inventoryTypeValue.trim() || "inventory";
	const property = settings.inventoryTypeProperty.trim() || "type";
	const out: TFile[] = [];
	for (const file of listMarkdownFilesInFolders(app, settings.inventoryFolders)) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
		if (!inventoryTypeMatches(fm[property], target)) continue;
		out.push(file);
	}
	return out;
}

/** Read and parse a single inventory page's body from disk. */
export async function readInventoryPage(
	app: App,
	file: TFile,
): Promise<InventoryPageContent> {
	const content = await app.vault.cachedRead(file);
	const { body } = splitFrontmatter(content);
	return parseInventoryBody(body);
}

/** Build the full markdown content for a brand-new inventory page. */
export function createInventoryPageContent(
	settings: PantrySettings,
	sections: InventorySection[],
): string {
	const property = settings.inventoryTypeProperty.trim() || "type";
	const value = settings.inventoryTypeValue.trim() || "inventory";
	const fm = `---\n${property}: ${value}\n---\n\n`;
	return `${fm}${serializeInventoryBody({ preamble: "", sections })}`;
}
