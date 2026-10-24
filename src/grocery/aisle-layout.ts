import { App, TFile, TFolder } from "obsidian";
import {
	AisleCategory,
	AisleLayout,
	AisleLocalState,
	AisleShop,
	DEFAULT_AISLE_LAYOUT_PATH,
	DEFAULT_AISLE_SHOP,
	DEFAULT_CATEGORY_ORDER,
	PantrySettings,
} from "../settings";
import { CategoryOverride } from "../types";

const LAYOUT_VERSION = 1;

interface AisleLayoutFile {
	version: number;
	shops: Record<string, AisleShop>;
}

export interface AisleLayoutRead {
	/** True when the vault file does not exist yet. */
	missing: boolean;
	/** Parsed layout. Null when the file exists but is not usable. */
	layout: AisleLayout | null;
}

/** Empty shared layout, before the first shop is created. */
export function emptyAisleLayout(): AisleLayout {
	return { shops: {} };
}

/** Empty device-local overlay. */
export function emptyAisleLocal(): AisleLocalState {
	return { shops: {} };
}

/** Vault-relative path with a usable default when the setting is blank. */
export function resolveAisleLayoutPath(path: string): string {
	const trimmed = path.trim().replace(/^\/+/, "").replace(/^\.\//, "");
	return trimmed || DEFAULT_AISLE_LAYOUT_PATH;
}

/** Flat names become top-level aisles, in order, with duplicates dropped. */
export function categoriesFromNames(names: readonly string[]): AisleCategory[] {
	const out: AisleCategory[] = [];
	const seen = new Set<string>();
	for (const raw of names) {
		const name = raw.trim();
		const key = name.toLowerCase();
		if (!name || seen.has(key)) continue;
		seen.add(key);
		out.push({ name });
	}
	return out;
}

/**
 * Parse the settings textarea. A line `Parent / Child` nests Child under
 * Parent, creating Parent when that line is the first mention of it.
 */
export function parseCategoryLines(text: string): AisleCategory[] {
	const out: AisleCategory[] = [];
	const seen = new Set<string>();
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		const slash = line.indexOf("/");
		let name = line;
		let parent: string | undefined;
		if (slash !== -1) {
			parent = line.slice(0, slash).trim();
			name = line.slice(slash + 1).trim();
			if (!parent || !name) continue;
		}
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		if (parent && !seen.has(parent.toLowerCase())) {
			seen.add(parent.toLowerCase());
			out.push({ name: parent });
		}
		seen.add(key);
		out.push(parent ? { name, parent } : { name });
	}
	return out;
}

/** Textarea form of a shop's aisles. Subcategories use `Parent / Child`. */
export function formatCategoryLines(categories: readonly AisleCategory[]): string {
	return categories
		.map((category) =>
			category.parent ? `${category.parent} / ${category.name}` : category.name,
		)
		.join("\n");
}

/**
 * Parent aisle for `name`, when that parent is itself in the list.
 * A missing parent leaves the aisle top-level.
 */
export function aisleParentOf(
	categories: readonly AisleCategory[],
	name: string,
): string | null {
	const found = categories.find(
		(category) => category.name.toLowerCase() === name.toLowerCase(),
	);
	const parent = found?.parent?.trim();
	if (!parent || parent.toLowerCase() === name.toLowerCase()) return null;
	const parentCategory = categories.find(
		(category) => category.name.toLowerCase() === parent.toLowerCase(),
	);
	return parentCategory?.name ?? null;
}

/** Top-level aisles, each followed by its children, in list order. */
export function categoryWalkOrder(categories: readonly AisleCategory[]): string[] {
	const names = new Set(categories.map((category) => category.name.toLowerCase()));
	const children = new Map<string, AisleCategory[]>();
	const tops: AisleCategory[] = [];
	for (const category of categories) {
		const parent = category.parent?.trim();
		if (
			parent &&
			parent.toLowerCase() !== category.name.toLowerCase() &&
			names.has(parent.toLowerCase())
		) {
			const key = parent.toLowerCase();
			const list = children.get(key);
			if (list) list.push(category);
			else children.set(key, [category]);
		} else {
			tops.push(category);
		}
	}

	const out: string[] = [];
	const emitted = new Set<string>();
	const emit = (category: AisleCategory): void => {
		const key = category.name.toLowerCase();
		if (emitted.has(key)) return;
		emitted.add(key);
		out.push(category.name);
		for (const child of children.get(key) ?? []) emit(child);
	};
	for (const category of tops) emit(category);
	for (const category of categories) emit(category);
	return out;
}

/**
 * Shared aisles first, then local aisles whose names are new.
 * A local override replaces a shared override with the same match.
 */
export function mergeAisleShop(shared: AisleShop, local: AisleShop | undefined): AisleShop {
	const categories = shared.categories.map((category) => ({ ...category }));
	const seen = new Set(categories.map((category) => category.name.toLowerCase()));
	for (const category of local?.categories ?? []) {
		const key = category.name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		categories.push({ ...category });
	}

	const localOverrides = (local?.overrides ?? []).map((override) => ({ ...override }));
	const localMatches = new Set(
		localOverrides.map((override) => override.match.trim().toLowerCase()),
	);
	const overrides = [
		...localOverrides,
		...shared.overrides
			.filter((override) => !localMatches.has(override.match.trim().toLowerCase()))
			.map((override) => ({ ...override })),
	];
	return { categories, overrides };
}

/** Write the active shop's effective order and overrides onto settings. */
export function applyEffectiveAisle(settings: PantrySettings): void {
	const shopName = settings.activeShop.trim() || DEFAULT_AISLE_SHOP;
	settings.activeShop = shopName;
	const shared = settings.aisleLayout.shops[shopName] ?? {
		categories: categoriesFromNames(DEFAULT_CATEGORY_ORDER),
		overrides: [],
	};
	const merged = mergeAisleShop(shared, settings.aisleLocal.shops[shopName]);
	settings.aisleCategories = merged.categories;
	settings.categoryOrder = categoryWalkOrder(merged.categories);
	settings.categoryOverrides = merged.overrides;
}

/**
 * Return the named shop, creating it from `seed` or the built-in aisle list.
 */
export function ensureShop(
	layout: AisleLayout,
	name: string,
	seed?: AisleShop,
): AisleShop {
	const existing = layout.shops[name];
	if (existing) return existing;
	const shop: AisleShop = seed
		? {
				categories: seed.categories.map((category) => ({ ...category })),
				overrides: seed.overrides.map((override) => ({ ...override })),
			}
		: {
				categories: categoriesFromNames(DEFAULT_CATEGORY_ORDER),
				overrides: [],
			};
	layout.shops[name] = shop;
	return shop;
}

/** Normalize a device-local overlay read from data.json. */
export function normalizeAisleLocal(raw: unknown): AisleLocalState {
	if (!raw || typeof raw !== "object") return emptyAisleLocal();
	const shopsIn = (raw as { shops?: unknown }).shops;
	if (!shopsIn || typeof shopsIn !== "object") return emptyAisleLocal();
	const shops: Record<string, AisleShop> = {};
	for (const [name, value] of Object.entries(shopsIn as Record<string, unknown>)) {
		const shopName = name.trim();
		if (!shopName) continue;
		const shop = normalizeShop(value);
		if (shop.categories.length === 0 && shop.overrides.length === 0) continue;
		shops[shopName] = shop;
	}
	return { shops };
}

/** Serialize the shared layout for the vault JSON file. */
export function serializeAisleLayout(layout: AisleLayout): string {
	const payload: AisleLayoutFile = {
		version: LAYOUT_VERSION,
		shops: layout.shops,
	};
	return `${JSON.stringify(payload, null, "\t")}\n`;
}

/** Parse an aisle-layout JSON file. Returns null when the content is unusable. */
export function parseAisleLayout(raw: string): AisleLayout | null {
	const trimmed = raw.trim();
	if (!trimmed) return emptyAisleLayout();
	try {
		const data = JSON.parse(trimmed) as unknown;
		if (!data || typeof data !== "object") return null;
		const shopsIn = (data as { shops?: unknown }).shops;
		if (!shopsIn || typeof shopsIn !== "object") return null;
		const shops: Record<string, AisleShop> = {};
		for (const [name, value] of Object.entries(shopsIn as Record<string, unknown>)) {
			const shopName = name.trim();
			if (!shopName) continue;
			shops[shopName] = normalizeShop(value);
		}
		return { shops };
	} catch {
		return null;
	}
}

/**
 * Read the shared layout. `missing` is true only when the file is absent;
 * a present but broken file returns `layout: null`.
 */
export async function readAisleLayoutFile(
	app: App,
	path: string,
): Promise<AisleLayoutRead> {
	const resolved = resolveAisleLayoutPath(path);
	const file = app.vault.getAbstractFileByPath(resolved);
	if (!(file instanceof TFile)) return { missing: true, layout: null };
	try {
		const raw = await app.vault.read(file);
		const layout = parseAisleLayout(raw);
		if (!layout) {
			console.error(`pantry: failed to parse aisle layout at ${resolved}`);
			return { missing: false, layout: null };
		}
		return { missing: false, layout };
	} catch (err) {
		console.error(`pantry: failed to read aisle layout at ${resolved}`, err);
		return { missing: false, layout: null };
	}
}

/** Write the shared layout to the vault, creating parent folders as needed. */
export async function writeAisleLayoutFile(
	app: App,
	path: string,
	layout: AisleLayout,
): Promise<TFile> {
	const resolved = resolveAisleLayoutPath(path);
	const content = serializeAisleLayout(layout);
	const existing = app.vault.getAbstractFileByPath(resolved);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
		return existing;
	}
	await ensureParentFolder(app, resolved);
	return app.vault.create(resolved, content);
}

function normalizeShop(value: unknown): AisleShop {
	if (!value || typeof value !== "object") {
		return { categories: [], overrides: [] };
	}
	const shop = value as { categories?: unknown; overrides?: unknown };
	return {
		categories: normalizeCategories(shop.categories),
		overrides: normalizeOverrides(shop.overrides),
	};
}

function normalizeCategories(value: unknown): AisleCategory[] {
	if (!Array.isArray(value)) return [];
	const out: AisleCategory[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const raw = entry as { name?: unknown; parent?: unknown };
		if (typeof raw.name !== "string") continue;
		const name = raw.name.trim();
		const key = name.toLowerCase();
		if (!name || seen.has(key)) continue;
		seen.add(key);
		const parent = typeof raw.parent === "string" ? raw.parent.trim() : "";
		out.push(parent ? { name, parent } : { name });
	}
	return out;
}

function normalizeOverrides(value: unknown): CategoryOverride[] {
	if (!Array.isArray(value)) return [];
	const out: CategoryOverride[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const raw = entry as { match?: unknown; category?: unknown };
		if (typeof raw.match !== "string" || typeof raw.category !== "string") continue;
		const match = raw.match.trim();
		const category = raw.category.trim();
		if (!match || !category) continue;
		out.push({ match, category });
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
