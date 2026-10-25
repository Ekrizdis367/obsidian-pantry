import {
	InventoryItem,
	InventoryPageContent,
	InventorySection,
	ShopLink,
} from "../types";
import { generateId } from "../utils/id";
import { trimEndText } from "../utils/text";
import { extractTrailingTags } from "./ingredient";

/** Fixed heading level that introduces a new section within an inventory page. */
const SECTION_HEADING_RE = /^##\s+(.*)$/;
const BULLET_ITEM_RE = /^\s*[-*+]\s+(.*)$/;
const HIDDEN_META_RE = /\s*<!--pantry:(.*?)-->\s*$/;
// Trailing "(have/want unit)" or "(have unit)" quantity marker, e.g. "(2/5 lb)", "(3)".
const QUANTITY_RE = /^(.*?)\s*\(\s*([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?([A-Za-z%]*)\s*\)\s*$/;

/** Shape of the hidden `<!--pantry:{...}-->` metadata blob on an item line. */
interface HiddenItemMeta {
	id?: string;
	exp?: string;
	notes?: string;
	added?: string;
	shop?: Array<{ n?: string; u?: string }>;
}

/** Split a note's raw content into its frontmatter block and body. */
export function splitFrontmatter(content: string): { fm: string; body: string } {
	if (!content.startsWith("---")) return { fm: "", body: content };
	const end = content.indexOf("\n---", 3);
	if (end === -1) return { fm: "", body: content };
	const afterIdx = content.indexOf("\n", end + 4);
	if (afterIdx === -1) return { fm: content, body: "" };
	return { fm: content.slice(0, afterIdx + 1), body: content.slice(afterIdx + 1) };
}

/** Format a number for the visible quantity marker, dropping unnecessary decimals. */
function formatQtyNumber(n: number): string {
	return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * Parse one inventory item bullet line.
 *
 * The visible text (name + trailing "(have/want unit)" quantity + trailing
 * #tags) is always the source of truth, so a hand-typed line like
 * `- Rice (2/5 lb) #baking` works even without the hidden metadata comment,
 * and a bare `- Rice` still parses fine (quantity defaults to 0/0). The
 * hidden `<!--pantry:{...}-->` comment (when present) supplies the rest:
 * stable id, expiration, notes, shop links.
 */
export function parseInventoryItemLine(line: string): InventoryItem | null {
	const bulletMatch = line.match(BULLET_ITEM_RE);
	if (!bulletMatch) return null;
	let rest = bulletMatch[1] ?? "";

	let meta: HiddenItemMeta = {};
	const metaMatch = rest.match(HIDDEN_META_RE);
	if (metaMatch) {
		rest = rest.slice(0, metaMatch.index).trim();
		try {
			const parsed: unknown = JSON.parse(metaMatch[1] ?? "{}");
			if (parsed && typeof parsed === "object") {
				meta = parsed;
			}
		} catch {
			// Malformed metadata: fall back to defaults, keep the visible text.
		}
	}

	const { text: withoutTags, tags } = extractTrailingTags(rest);

	let quantity = 0;
	let desiredQuantity = 0;
	let unit = "";
	let name = withoutTags;
	const qtyMatch = withoutTags.match(QUANTITY_RE);
	if (qtyMatch) {
		const have = Number(qtyMatch[2]);
		const want = qtyMatch[3] !== undefined ? Number(qtyMatch[3]) : 0;
		if (Number.isFinite(have)) {
			name = (qtyMatch[1] ?? "").trim();
			quantity = have;
			desiredQuantity = Number.isFinite(want) ? want : 0;
			unit = qtyMatch[4] ?? "";
		}
	}

	const trimmedName = name.trim();
	if (!trimmedName) return null;

	const shopLinks: ShopLink[] = Array.isArray(meta.shop)
		? meta.shop
				.filter((s): s is { n?: string; u?: string } => !!s && typeof s === "object")
				.map((s) => ({ nickname: String(s.n ?? ""), url: String(s.u ?? "") }))
				.filter((l) => l.url !== "")
		: [];

	return {
		id: typeof meta.id === "string" && meta.id ? meta.id : generateId(),
		name: trimmedName,
		quantity,
		desiredQuantity,
		unit,
		category: null,
		dateAdded: typeof meta.added === "string" ? meta.added : new Date().toISOString(),
		expirationDate: typeof meta.exp === "string" && meta.exp ? meta.exp : null,
		notes: typeof meta.notes === "string" && meta.notes ? meta.notes : null,
		tags,
		shopLinks,
	};
}

/** Serialize one inventory item back to its bullet-line form. */
export function serializeInventoryItemLine(item: InventoryItem): string {
	const have = item.quantity || 0;
	const want = item.desiredQuantity || 0;
	let qtyText = "";
	if (have !== 0 || want !== 0 || item.unit) {
		const qty = want > 0 ? `${formatQtyNumber(have)}/${formatQtyNumber(want)}` : formatQtyNumber(have);
		qtyText = ` (${qty}${item.unit ? ` ${item.unit}` : ""})`;
	}
	const tagsText = item.tags.length > 0 ? ` ${item.tags.map((t) => `#${t}`).join(" ")}` : "";

	const meta: HiddenItemMeta = { id: item.id };
	if (item.expirationDate) meta.exp = item.expirationDate;
	if (item.notes) meta.notes = item.notes;
	if (item.dateAdded) meta.added = item.dateAdded;
	if (item.shopLinks.length > 0) {
		meta.shop = item.shopLinks.map((l) => ({ n: l.nickname, u: l.url }));
	}

	return `- ${item.name}${qtyText}${tagsText} <!--pantry:${JSON.stringify(meta)}-->`;
}

/**
 * Parse an inventory page's body (frontmatter already stripped) into an
 * ordered list of sections. Any `## ` heading starts a new section; its
 * trailing #tags become the section's tags. List items directly under a
 * heading become its items; other non-blank lines are preserved verbatim as
 * `extraLines` so a user's freeform notes under a section aren't lost.
 *
 * If the body has no `## ` headings at all (e.g. a bare bullet list, or an
 * empty new note), everything collected is folded into a single implicit
 * "Items" section, so a page always has at least one section.
 */
export function parseInventoryBody(body: string): InventoryPageContent {
	const lines = body.split(/\r?\n/);
	const preambleLines: string[] = [];
	const sections: InventorySection[] = [];
	let current: InventorySection | null = null;

	for (const line of lines) {
		const heading = line.match(SECTION_HEADING_RE);
		if (heading) {
			const { text, tags } = extractTrailingTags(heading[1] ?? "");
			current = { name: text.trim() || "Section", tags, items: [], extraLines: [] };
			sections.push(current);
			continue;
		}

		const isListLine = BULLET_ITEM_RE.test(line);

		if (!current) {
			if (isListLine) {
				current = { name: "Items", tags: [], items: [], extraLines: [] };
				sections.push(current);
			} else {
				preambleLines.push(line);
				continue;
			}
		}

		if (isListLine) {
			const item = parseInventoryItemLine(line);
			if (item) current.items.push(item);
			continue;
		}

		if (line.trim() === "") continue;
		current.extraLines.push(line);
	}

	if (sections.length === 0) {
		sections.push({ name: "Items", tags: [], items: [], extraLines: [] });
	}

	return { preamble: trimEndText(preambleLines.join("\n")), sections };
}

/** Serialize parsed page content back to markdown body text (no frontmatter). */
export function serializeInventoryBody(content: InventoryPageContent): string {
	const parts: string[] = [];
	if (content.preamble.trim()) {
		parts.push(content.preamble.trim(), "");
	}
	for (const section of content.sections) {
		const tagsText =
			section.tags.length > 0 ? ` ${section.tags.map((t) => `#${t}`).join(" ")}` : "";
		parts.push(`## ${section.name}${tagsText}`);
		for (const item of section.items) {
			parts.push(serializeInventoryItemLine(item));
		}
		for (const extra of section.extraLines) {
			parts.push(extra);
		}
		parts.push("");
	}
	return `${trimEndText(parts.join("\n"))}\n`;
}

/** Replace an inventory note's body while leaving its frontmatter untouched. */
export function replaceInventoryBody(content: string, page: InventoryPageContent): string {
	const { fm } = splitFrontmatter(content);
	return `${fm}${serializeInventoryBody(page)}`;
}

/**
 * Items typed by hand (no hidden id comment) get a fresh random id on every
 * parse. Re-use the id `previous` assigned to the same item (matched by
 * section + name) so ids held by the UI stay valid across a re-parse.
 */
export function adoptItemIds(fresh: InventoryPageContent, previous: InventoryPageContent): void {
	const freshIds = new Set(fresh.sections.flatMap((s) => s.items.map((i) => i.id)));
	const previousIds = new Set<string>();
	const pool = new Map<string, string[]>();
	for (const section of previous.sections) {
		for (const item of section.items) {
			previousIds.add(item.id);
			if (freshIds.has(item.id)) continue;
			const key = `${section.name}\u0000${item.name.toLowerCase()}`;
			const ids = pool.get(key);
			if (ids) ids.push(item.id);
			else pool.set(key, [item.id]);
		}
	}
	if (pool.size === 0) return;
	for (const section of fresh.sections) {
		for (const item of section.items) {
			if (previousIds.has(item.id)) continue;
			const adopted = pool.get(`${section.name}\u0000${item.name.toLowerCase()}`)?.shift();
			if (adopted) item.id = adopted;
		}
	}
}
