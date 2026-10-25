import { App, TFile, TFolder } from "obsidian";

/** Result of reading a vault file that may not be indexed yet on mobile cold start. */
export type VaultTextRead =
	| { status: "missing" }
	| { status: "unreadable" }
	| { status: "ok"; text: string };

/**
 * Read a vault file.
 *
 * After a mobile force-quit the file list can lag behind the files already
 * on disk, and a synced file can be indexed before its bytes are readable.
 * Falling through to the adapter covers the first case. A failed read is
 * reported as unreadable so callers do not create a second copy over it.
 */
export async function readVaultText(app: App, path: string): Promise<VaultTextRead> {
	const indexed = app.vault.getAbstractFileByPath(path);
	if (indexed instanceof TFile) {
		try {
			return { status: "ok", text: await app.vault.read(indexed) };
		} catch (err) {
			console.error(`pantry: failed to read ${path}`, err);
			return { status: "unreadable" };
		}
	}

	const adapter = app.vault.adapter;
	if (typeof adapter?.exists !== "function" || typeof adapter.read !== "function") {
		return { status: "missing" };
	}
	try {
		if (!(await adapter.exists(path))) return { status: "missing" };
		return { status: "ok", text: await adapter.read(path) };
	} catch (err) {
		console.error(`pantry: failed to read ${path}`, err);
		return { status: "unreadable" };
	}
}

/**
 * Write a vault file, creating parent folders as needed.
 *
 * `create` throws when the file is already on disk but not in the file list
 * yet. That race is recovered by modifying the indexed file, or by writing
 * through the adapter when the list still does not contain it.
 */
export async function writeVaultText(
	app: App,
	path: string,
	content: string,
): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
		return;
	}
	await ensureParentFolder(app, path);
	try {
		await app.vault.create(path, content);
	} catch (err) {
		const raced = app.vault.getAbstractFileByPath(path);
		if (raced instanceof TFile) {
			await app.vault.modify(raced, content);
			return;
		}
		const adapter = app.vault.adapter;
		if (
			typeof adapter?.exists === "function" &&
			typeof adapter.write === "function" &&
			(await adapter.exists(path))
		) {
			await adapter.write(path, content);
			return;
		}
		throw err;
	}
}

async function ensureParentFolder(app: App, path: string): Promise<void> {
	const slash = path.lastIndexOf("/");
	if (slash === -1) return;
	const dir = path.slice(0, slash);
	if (!dir) return;
	const existing = app.vault.getAbstractFileByPath(dir);
	if (existing instanceof TFolder) return;
	try {
		await app.vault.createFolder(dir);
	} catch {
		// Folder may already exist or be created concurrently.
	}
}
