import { App, TFile, TFolder } from "obsidian";
import {
	DEFAULT_SHOPPING_STATE_PATH,
	PantrySavedState,
} from "../settings";
import { OneOffItem } from "../types";

export { DEFAULT_SHOPPING_STATE_PATH };

const STATE_VERSION = 1;

interface ShoppingStateFile {
	version: number;
	oneOffs: OneOffItem[];
	checkedKeys: Record<string, boolean>;
	collapsedGroups: Record<string, boolean>;
}

/** Empty runtime state used when the vault file is missing or invalid. */
export function emptyShoppingState(): PantrySavedState {
	return {
		oneOffs: [],
		checkedKeys: {},
		collapsedGroups: {},
	};
}

/** True when any shopping-list runtime fields have content. */
export function shoppingStateHasContent(state: PantrySavedState): boolean {
	return (
		state.oneOffs.length > 0 ||
		Object.keys(state.checkedKeys).length > 0 ||
		Object.keys(state.collapsedGroups).length > 0
	);
}

/**
 * Merge vault state with legacy plugin-data state during migration.
 * Vault entries win on id conflicts; legacy-only one-offs are kept.
 */
export function mergeShoppingState(
	vault: PantrySavedState,
	legacy: PantrySavedState,
): PantrySavedState {
	const byId = new Map(vault.oneOffs.map((o) => [o.id, o]));
	for (const item of legacy.oneOffs) {
		if (!byId.has(item.id)) byId.set(item.id, item);
	}
	return {
		oneOffs: [...byId.values()],
		checkedKeys: { ...legacy.checkedKeys, ...vault.checkedKeys },
		collapsedGroups: {
			...legacy.collapsedGroups,
			...vault.collapsedGroups,
		},
	};
}

/** Serialize shopping state for the vault JSON file. */
export function serializeShoppingState(state: PantrySavedState): string {
	const payload: ShoppingStateFile = {
		version: STATE_VERSION,
		oneOffs: state.oneOffs,
		checkedKeys: state.checkedKeys,
		collapsedGroups: state.collapsedGroups,
	};
	return `${JSON.stringify(payload, null, "\t")}\n`;
}

/** Parse a shopping-state JSON file. Returns null when the content is unusable. */
export function parseShoppingState(raw: string): PantrySavedState | null {
	const trimmed = raw.trim();
	if (!trimmed) return emptyShoppingState();
	try {
		const data = JSON.parse(trimmed) as unknown;
		if (!data || typeof data !== "object") return null;
		const obj = data as Partial<ShoppingStateFile>;
		return {
			oneOffs: normalizeOneOffs(obj.oneOffs),
			checkedKeys: normalizeStringBoolMap(obj.checkedKeys),
			collapsedGroups: normalizeStringBoolMap(obj.collapsedGroups),
		};
	} catch {
		return null;
	}
}

/**
 * Read shopping state from the vault. Returns null when the file does not
 * exist yet (caller may migrate from legacy plugin data).
 */
export async function readShoppingStateFile(
	app: App,
	path: string,
): Promise<PantrySavedState | null> {
	const resolved = resolveShoppingStatePath(path);
	const file = app.vault.getAbstractFileByPath(resolved);
	if (!(file instanceof TFile)) return null;
	const raw = await app.vault.cachedRead(file);
	const parsed = parseShoppingState(raw);
	if (!parsed) {
		console.error(`pantry: failed to parse shopping state at ${resolved}`);
		return emptyShoppingState();
	}
	return parsed;
}

/** Write shopping state to the vault, creating parent folders as needed. */
export async function writeShoppingStateFile(
	app: App,
	path: string,
	state: PantrySavedState,
): Promise<TFile> {
	const resolved = resolveShoppingStatePath(path);
	const content = serializeShoppingState(state);
	const existing = app.vault.getAbstractFileByPath(resolved);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
		return existing;
	}
	await ensureParentFolder(app, resolved);
	return app.vault.create(resolved, content);
}

/** Vault-relative path with a usable default when the setting is blank. */
export function resolveShoppingStatePath(path: string): string {
	const trimmed = path.trim().replace(/^\/+/, "");
	return trimmed || DEFAULT_SHOPPING_STATE_PATH;
}

function normalizeOneOffs(value: unknown): OneOffItem[] {
	if (!Array.isArray(value)) return [];
	const out: OneOffItem[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const item = entry as Partial<OneOffItem>;
		if (typeof item.id !== "string" || !item.id.trim()) continue;
		if (typeof item.name !== "string" || !item.name.trim()) continue;
		out.push({
			id: item.id,
			name: item.name.trim(),
			quantity:
				typeof item.quantity === "number" && Number.isFinite(item.quantity)
					? item.quantity
					: null,
			unit: typeof item.unit === "string" ? item.unit : "",
			category:
				typeof item.category === "string" && item.category.trim()
					? item.category.trim()
					: null,
		});
	}
	return out;
}

function normalizeStringBoolMap(value: unknown): Record<string, boolean> {
	if (!value || typeof value !== "object") return {};
	const out: Record<string, boolean> = {};
	for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
		if (flag === true) out[key] = true;
	}
	return out;
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
