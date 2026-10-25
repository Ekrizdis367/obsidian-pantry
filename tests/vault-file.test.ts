import assert from "node:assert/strict";
import { test } from "node:test";
import type { App } from "obsidian";
import { readShoppingStateFile } from "../src/grocery/shopping-state";
import { readVaultText, writeVaultText } from "../src/utils/vault-file";

function appWithDiskFile(path: string, text: string): {
	app: App;
	failRead: () => void;
} {
	const disk = new Map<string, string>([[path, text]]);
	let readError: Error | null = null;
	const app = {
		vault: {
			getAbstractFileByPath: () => null,
			adapter: {
				exists: async (p: string) => disk.has(p),
				read: async (p: string) => {
					if (readError) throw readError;
					const value = disk.get(p);
					if (value === undefined) throw new Error("missing");
					return value;
				},
				write: async (p: string, content: string) => {
					disk.set(p, content);
				},
			},
			create: async () => {
				throw new Error(`File already exists: ${path}`);
			},
			createFolder: async () => {},
			modify: async () => {},
		},
	} as unknown as App;
	return {
		app,
		failRead: () => {
			readError = new Error("not downloaded");
		},
	};
}

test("a file on disk but missing from the vault index is still read", async () => {
	const { app } = appWithDiskFile(
		"Pantry/shopping-state.json",
		JSON.stringify({ version: 1, oneOffs: [], checkedKeys: {}, collapsedGroups: {} }),
	);
	const read = await readVaultText(app, "Pantry/shopping-state.json");
	assert.equal(read.status, "ok");
	const state = await readShoppingStateFile(app, "Pantry/shopping-state.json");
	assert.equal(state.status, "ok");
});

test("a file that exists but cannot be read is unreadable", async () => {
	const { app, failRead } = appWithDiskFile("Pantry/shopping-state.json", "{}");
	failRead();
	const read = await readVaultText(app, "Pantry/shopping-state.json");
	assert.equal(read.status, "unreadable");
});

test("create racing an existing on-disk file writes through the adapter", async () => {
	const { app } = appWithDiskFile("Pantry/shopping-state.json", "old");
	await writeVaultText(app, "Pantry/shopping-state.json", "new");
	assert.equal(await app.vault.adapter.read("Pantry/shopping-state.json"), "new");
});
