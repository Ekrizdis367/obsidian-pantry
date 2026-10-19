import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { InventoryManager } from "../src/grocery/inventory-manager";
import { DEFAULT_SETTINGS, PantrySettings } from "../src/settings";

/** Yield to the event loop, standing in for real disk I/O latency. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Minimal in-memory vault covering the App surface the inventory code uses.
 * `process` deliberately yields between read and write so unserialized
 * concurrent writes would lose updates, the way slow disk I/O can.
 */
export class FakeVault {
	private readonly entries = new Map<string, TAbstractFile>();
	private readonly contents = new Map<string, string>();
	readonly root: TFolder;

	constructor(files: Record<string, string> = {}) {
		this.root = new TFolder();
		this.root.path = "/";
		for (const [path, content] of Object.entries(files)) this.write(path, content);
	}

	/** Create or overwrite a file directly, like an external edit or sync. */
	write(path: string, content: string): TFile {
		this.contents.set(path, content);
		const existing = this.entries.get(path);
		if (existing instanceof TFile) return existing;
		const slash = path.lastIndexOf("/");
		const parent = slash === -1 ? this.root : this.ensureFolder(path.slice(0, slash));
		const file = new TFile();
		file.path = path;
		file.name = path.slice(slash + 1);
		file.extension = file.name.split(".").pop() ?? "";
		file.basename = file.name.replace(/\.[^.]+$/, "");
		file.parent = parent;
		parent.children.push(file);
		this.entries.set(path, file);
		return file;
	}

	content(path: string): string | undefined {
		return this.contents.get(path);
	}

	paths(): string[] {
		return [...this.contents.keys()].sort();
	}

	private ensureFolder(path: string): TFolder {
		const existing = this.entries.get(path);
		if (existing instanceof TFolder) return existing;
		const slash = path.lastIndexOf("/");
		const parent = slash === -1 ? this.root : this.ensureFolder(path.slice(0, slash));
		const folder = new TFolder();
		folder.path = path;
		folder.name = path.slice(slash + 1);
		folder.parent = parent;
		parent.children.push(folder);
		this.entries.set(path, folder);
		return folder;
	}

	private frontmatter(path: string): Record<string, string> | undefined {
		const match = /^---\n([\s\S]*?)\n---/.exec(this.contents.get(path) ?? "");
		if (!match) return undefined;
		const fm: Record<string, string> = {};
		for (const line of (match[1] ?? "").split("\n")) {
			const [key, ...rest] = line.split(":");
			if (key && rest.length > 0) fm[key.trim()] = rest.join(":").trim();
		}
		return fm;
	}

	/** The subset of `App` the inventory code touches, cast for the real types. */
	asApp(): App {
		const app = {
			vault: {
				getRoot: () => this.root,
				getAbstractFileByPath: (path: string) => this.entries.get(path) ?? null,
				read: async (file: TFile) => {
					await tick();
					return this.contents.get(file.path) ?? "";
				},
				cachedRead: async (file: TFile) => this.contents.get(file.path) ?? "",
				create: async (path: string, content: string) => {
					await tick();
					if (this.contents.has(path)) throw new Error(`File already exists: ${path}`);
					return this.write(path, content);
				},
				createFolder: async (path: string) => {
					await tick();
					this.ensureFolder(path);
				},
				process: async (file: TFile, fn: (data: string) => string) => {
					const data = this.contents.get(file.path) ?? "";
					await tick();
					const out = fn(data);
					await tick();
					this.contents.set(file.path, out);
					return out;
				},
			},
			metadataCache: {
				getFileCache: (file: TFile) => {
					const frontmatter = this.frontmatter(file.path);
					return frontmatter ? { frontmatter } : null;
				},
			},
		};
		return app as unknown as App;
	}
}

export function testSettings(overrides: Partial<PantrySettings> = {}): PantrySettings {
	return {
		...DEFAULT_SETTINGS,
		inventoryState: { ...DEFAULT_SETTINGS.inventoryState },
		...overrides,
	};
}

export async function loadedManager(
	vault: FakeVault,
	settings: PantrySettings = testSettings(),
): Promise<InventoryManager> {
	const manager = new InventoryManager(vault.asApp(), {
		settings,
		save: async () => {},
	});
	await manager.refresh();
	return manager;
}
