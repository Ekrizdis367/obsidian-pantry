import { App, TFile } from "obsidian";
import {
	DEFAULT_INVENTORY_STATE_PATH,
	PantrySavedInventoryState,
} from "../settings";
import { InventoryItem, ShopLink } from "../types";

export { DEFAULT_INVENTORY_STATE_PATH };

const STATE_VERSION = 1;

interface InventoryStateFile {
	version: number;
	items: InventoryItem[];
	collapsedGroups: Record<string, boolean>;
	groupBy: "category" | "tag";
	rowScale: number;
}

const MIN_ROW_SCALE = 0.8;
const MAX_ROW_SCALE = 1.4;

function clampRowScale(value: unknown): number {
	const n = typeof value === "number" && Number.isFinite(value) ? value : 1;
	return Math.min(MAX_ROW_SCALE, Math.max(MIN_ROW_SCALE, n));
}

/** Empty runtime state used when the vault file is missing or invalid. */
export function emptyInventoryState(): PantrySavedInventoryState {
	return {
		items: [],
		collapsedGroups: {},
		groupBy: "category",
		rowScale: 1,
	};
}

/** True when any inventory runtime fields have content. */
export function inventoryStateHasContent(
	state: PantrySavedInventoryState,
): boolean {
	return (
		state.items.length > 0 || Object.keys(state.collapsedGroups).length > 0
	);
}

/**
 * Merge vault state with legacy plugin-data state during migration.
 * Vault entries win on id conflicts; legacy-only items are kept.
 */
export function mergeInventoryState(
	vault: PantrySavedInventoryState,
	legacy: PantrySavedInventoryState,
): PantrySavedInventoryState {
	const byId = new Map(vault.items.map((o) => [o.id, o]));
	for (const item of legacy.items) {
		if (!byId.has(item.id)) byId.set(item.id, item);
	}
	return {
		items: [...byId.values()],
		collapsedGroups: {
			...legacy.collapsedGroups,
			...vault.collapsedGroups,
		},
		groupBy: vault.groupBy,
		rowScale: vault.rowScale,
	};
}

/** Serialize inventory state for the vault JSON file. */
export function serializeInventoryState(state: PantrySavedInventoryState): string {
	const payload: InventoryStateFile = {
		version: STATE_VERSION,
		items: state.items,
		collapsedGroups: state.collapsedGroups,
		groupBy: state.groupBy,
		rowScale: state.rowScale,
	};
	return `${JSON.stringify(payload, null, "\t")}\n`;
}

/** Parse an inventory-state JSON file. Returns null when the content is unusable. */
export function parseInventoryState(raw: string): PantrySavedInventoryState | null {
	const trimmed = raw.trim();
	if (!trimmed) return emptyInventoryState();
	try {
		const data = JSON.parse(trimmed) as unknown;
		if (!data || typeof data !== "object") return null;
		const obj = data as Partial<InventoryStateFile>;
		return {
			items: normalizeInventoryItems(obj.items),
			collapsedGroups: normalizeStringBoolMap(obj.collapsedGroups),
			groupBy: obj.groupBy === "tag" ? "tag" : "category",
			rowScale: clampRowScale(obj.rowScale),
		};
	} catch {
		return null;
	}
}

/**
 * Read inventory state from the vault. Returns null when the file does not
 * exist yet (caller may migrate from legacy plugin data).
 */
export async function readInventoryStateFile(
	app: App,
	path: string,
): Promise<PantrySavedInventoryState | null> {
	const resolved = resolveInventoryStatePath(path);
	const file = app.vault.getAbstractFileByPath(resolved);
	if (!(file instanceof TFile)) return null;
	const raw = await app.vault.cachedRead(file);
	const parsed = parseInventoryState(raw);
	return parsed;
}

/**
 * Write inventory state to the vault. Creates parent folders and the JSON file
 * if they don't exist.
 */
export async function writeInventoryStateFile(
	app: App,
	path: string,
	state: PantrySavedInventoryState,
): Promise<void> {
	const resolved = resolveInventoryStatePath(path);
	const parentPath = resolved.substring(0, resolved.lastIndexOf("/"));

	if (parentPath && !app.vault.getAbstractFileByPath(parentPath)) {
		await app.vault.createFolder(parentPath);
	}

	const existing = app.vault.getAbstractFileByPath(resolved);
	const content = serializeInventoryState(state);

	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
	} else {
		await app.vault.create(resolved, content);
	}
}

/**
 * Normalize the vault path to be absolute (strip any leading "./").
 * Obsidian's vault API is inconsistent about these.
 */
export function resolveInventoryStatePath(path: string): string {
	return path.replace(/^\.\//, "");
}

// ============================================================================
// Normalization helpers (internal)
// ============================================================================

export function normalizeInventoryItems(raw: unknown): InventoryItem[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((item) => {
			if (typeof item !== "object" || !item) return null;
			const obj = item as Record<string, unknown>;
			const id = typeof obj.id === "string" ? obj.id : null;
			if (!id) return null;
			return {
				id,
				name: typeof obj.name === "string" ? obj.name : "",
				quantity:
					typeof obj.quantity === "number" ? obj.quantity : null,
				desiredQuantity:
					typeof obj.desiredQuantity === "number" ? obj.desiredQuantity : null,
				unit: typeof obj.unit === "string" ? obj.unit : "",
				category:
					typeof obj.category === "string" ? obj.category : null,
				dateAdded:
					typeof obj.dateAdded === "string"
						? obj.dateAdded
						: new Date().toISOString(),
				expirationDate:
					typeof obj.expirationDate === "string"
						? obj.expirationDate
						: null,
				notes: typeof obj.notes === "string" ? obj.notes : null,
				tags: normalizeTags(obj.tags),
				shopLinks: normalizeShopLinks(obj.shopLinks),
			};
		})
		.filter((item) => item !== null);
}

function normalizeTags(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((t): t is string => typeof t === "string" && t.trim() !== "");
}

function normalizeShopLinks(raw: unknown): ShopLink[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((link) => {
			if (typeof link !== "object" || !link) return null;
			const obj = link as Record<string, unknown>;
			const url = typeof obj.url === "string" ? obj.url.trim() : "";
			if (!url) return null;
			return {
				nickname: typeof obj.nickname === "string" ? obj.nickname : "",
				url,
			};
		})
		.filter((link): link is ShopLink => link !== null)
		.slice(0, 4);
}

function normalizeStringBoolMap(raw: unknown): Record<string, boolean> {
	if (typeof raw !== "object" || !raw) return {};
	const result: Record<string, boolean> = {};
	for (const [key, val] of Object.entries(raw)) {
		if (typeof val === "boolean") result[key] = val;
	}
	return result;
}
