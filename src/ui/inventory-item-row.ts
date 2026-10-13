import { App, Menu, Notice, setIcon } from "obsidian";
import { InventoryManager, newInventoryItem } from "../grocery/inventory-manager";
import { InventoryEntry, InventoryItem, InventorySection } from "../types";
import { toTitleCase } from "../utils/text";
import {
	getItemStatus,
	getStatusClass,
	getStatusIcon,
	getStatusLabel,
} from "../utils/inventory-status";
import { renderShopLinkButtons } from "./shop-link-buttons";
import { AddItemModal } from "./add-inventory-item-modal";
import { StringSuggest } from "./name-suggest";
import { ConfirmModal } from "./confirm-modal";

/** Delay (ms) before the hover card appears on row mouseover. */
const HOVER_CARD_DELAY_MS = 1500;

/** Drag data MIME type used to move an item by dragging its card onto a section/group. */
const DRAG_ITEM_TYPE = "application/x-pantry-inventory-item";

interface DragPayload {
	filePath: string;
	itemId: string;
}

/**
 * Everything a view needs to share for rendering item rows/section cards:
 * the floating hover-card element it owns, small mutable bags for the
 * pending hover timer and the currently-focused row (so re-renders can
 * restore keyboard focus), and how to find the scrollable region arrow-key
 * navigation should stay within. Used by both the Inventory tab's Manage
 * mode and the standalone per-page view so row/section rendering, hover
 * cards, and keyboard nav aren't duplicated between them.
 */
export interface RowContext {
	app: App;
	manager: InventoryManager;
	hoverCardEl: HTMLElement;
	hover: { timer: number | null };
	focus: { key: string | null };
	getScopeEl: () => HTMLElement;
}

/** Stable DOM key for a row, since items are scoped to a page + id. */
export function rowKey(entry: InventoryEntry): string {
	return `${entry.filePath}::${entry.item.id}`;
}

export function openEditItemModal(app: App, manager: InventoryManager, entry: InventoryEntry): void {
	new AddItemModal(
		app,
		manager,
		{ filePath: entry.filePath, sectionName: entry.sectionName },
		entry,
	).open();
}

/**
 * Small anchored menu listing every other section (across every page) as a
 * one-click move target — lighter than a full modal for sending an item to
 * a different list. Built on Obsidian's own Menu so positioning, scrolling,
 * and outside-click/Escape dismissal all come for free.
 */
function openMoveMenu(ctx: RowContext, anchorEl: HTMLElement, entry: InventoryEntry): void {
	const menu = new Menu();

	const targets: Array<{ filePath: string; pageName: string; sectionName: string }> = [];
	for (const { file, page } of ctx.manager.getPages()) {
		for (const section of page.sections) {
			if (file.path === entry.filePath && section.name === entry.sectionName) continue;
			targets.push({ filePath: file.path, pageName: file.basename, sectionName: section.name });
		}
	}

	if (targets.length === 0) {
		menu.addItem((item) => item.setTitle("No other lists yet").setDisabled(true));
	} else {
		let currentPage = "";
		for (const target of targets) {
			if (target.pageName !== currentPage) {
				currentPage = target.pageName;
				menu.addItem((item) => item.setTitle(target.pageName).setIsLabel(true));
			}
			menu.addItem((item) =>
				item.setTitle(target.sectionName).onClick(() => {
					void ctx.manager.moveItemToPage(
						entry.filePath,
						entry.item.id,
						target.filePath,
						target.sectionName,
					);
					new Notice(`Moved to ${target.pageName} › ${target.sectionName}`);
				}),
			);
		}
	}

	const rect = anchorEl.getBoundingClientRect();
	menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
}

/**
 * Makes `el` a drop target for item cards dragged from anywhere in the
 * inventory (Overview groups, section cards, even the standalone page
 * view) — dropping calls the same cross-page move used by the popover.
 */
export function wireItemDropTarget(
	ctx: RowContext,
	el: HTMLElement,
	targetFilePath: string,
	targetSectionName: string,
): void {
	el.addEventListener("dragover", (evt) => {
		if (!evt.dataTransfer?.types.includes(DRAG_ITEM_TYPE)) return;
		evt.preventDefault();
		evt.dataTransfer.dropEffect = "move";
		el.addClass("is-drop-target");
	});
	el.addEventListener("dragleave", (evt) => {
		if (evt.relatedTarget instanceof Node && el.contains(evt.relatedTarget)) return;
		el.removeClass("is-drop-target");
	});
	el.addEventListener("drop", (evt) => {
		evt.preventDefault();
		el.removeClass("is-drop-target");
		const raw = evt.dataTransfer?.getData(DRAG_ITEM_TYPE);
		if (!raw) return;
		const payload = JSON.parse(raw) as DragPayload;
		void ctx.manager.moveItemToPage(payload.filePath, payload.itemId, targetFilePath, targetSectionName);
	});
}

export function confirmRemoveItem(app: App, manager: InventoryManager, entry: InventoryEntry): void {
	new ConfirmModal(app, {
		title: "Remove item",
		message: "Are you sure you want to remove this item from inventory?",
		confirmText: "Remove",
		destructive: true,
		onConfirm: async () => {
			try {
				await manager.removeItem(entry.filePath, entry.item.id);
				new Notice("Item removed from inventory");
			} catch (e) {
				new Notice(`Error removing item: ${String(e)}`);
			}
		},
	}).open();
}

export function confirmRemoveSection(
	app: App,
	manager: InventoryManager,
	filePath: string,
	name: string,
): void {
	new ConfirmModal(app, {
		title: "Remove section",
		message: `Remove the "${name}" section? Any items in it move to another section on this page — nothing is deleted.`,
		confirmText: "Remove section",
		destructive: true,
		onConfirm: async () => {
			const ok = await manager.removeSection(filePath, name);
			if (!ok) new Notice("A page needs at least one section.");
		},
	}).open();
}

/** Restore keyboard focus to a row after a re-render, by its stable key. */
export function restoreFocus(ctx: RowContext): void {
	if (!ctx.focus.key) return;
	const row = ctx.getScopeEl().querySelector<HTMLElement>(
		`[data-row-key="${CSS.escape(ctx.focus.key)}"]`,
	);
	row?.focus({ preventScroll: true });
}

function cancelHoverCard(ctx: RowContext): void {
	if (ctx.hover.timer !== null) {
		window.clearTimeout(ctx.hover.timer);
		ctx.hover.timer = null;
	}
	ctx.hoverCardEl.addClass("is-hidden");
}

function scheduleHoverCard(ctx: RowContext, row: HTMLElement, entry: InventoryEntry): void {
	cancelHoverCard(ctx);
	ctx.hover.timer = window.setTimeout(() => {
		showHoverCard(ctx, row, entry);
	}, HOVER_CARD_DELAY_MS);
}

/**
 * Quick-glance details on hover — shop links are deliberately omitted.
 * Card appears after HOVER_CARD_DELAY_MS, positioned below the row and
 * nudged on-screen via requestAnimationFrame after rendering to get an
 * accurate size.
 */
function showHoverCard(ctx: RowContext, row: HTMLElement, entry: InventoryEntry): void {
	const { item } = entry;
	const card = ctx.hoverCardEl;
	card.empty();
	card.removeClass("is-hidden");

	card.createDiv({ cls: "pantry-hover-card-title", text: toTitleCase(item.name) });

	const unitSuffix = item.unit ? ` ${item.unit}` : "";
	const rows: Array<[string, string]> = [
		["Have", `${item.quantity || 0}${unitSuffix}`],
		["Want", item.desiredQuantity > 0 ? `${item.desiredQuantity}${unitSuffix}` : "Not tracked"],
	];
	if (entry.pageName) rows.push(["Page", entry.pageName]);
	rows.push(["Section", entry.sectionName]);
	if (item.expirationDate) rows.push(["Expires", item.expirationDate]);
	if (item.tags.length) rows.push(["Tags", item.tags.join(", ")]);
	if (item.notes) rows.push(["Notes", item.notes]);

	for (const [label, value] of rows) {
		const r = card.createDiv({ cls: "pantry-hover-card-row" });
		r.createSpan({ cls: "pantry-hover-card-label", text: label });
		r.createSpan({ cls: "pantry-hover-card-value", text: value });
	}

	const rect = row.getBoundingClientRect();
	card.style.setProperty("left", `${rect.left}px`);
	card.style.setProperty("top", `${rect.bottom + 4}px`);

	window.requestAnimationFrame(() => {
		const cardRect = card.getBoundingClientRect();
		if (cardRect.right > window.innerWidth) {
			card.style.setProperty("left", `${Math.max(4, window.innerWidth - cardRect.width - 8)}px`);
		}
		if (cardRect.bottom > window.innerHeight) {
			card.style.setProperty("top", `${Math.max(4, rect.top - cardRect.height - 4)}px`);
		}
	});
}

function focusAdjacentRow(ctx: RowContext, current: HTMLElement, delta: number): void {
	const rows = Array.from(
		ctx.getScopeEl().querySelectorAll<HTMLElement>(".pantry-item"),
	).filter((el) => !el.closest(".pantry-group.is-collapsed"));
	const idx = rows.indexOf(current);
	if (idx === -1) return;
	const next = rows[idx + delta];
	next?.focus();
}

/**
 * Arrow keys move focus between rows. Left/right (optionally with Shift)
 * adjust have/want by one without needing to click into the stepper.
 */
function onRowKeydown(ctx: RowContext, evt: KeyboardEvent, row: HTMLElement, entry: InventoryEntry): void {
	switch (evt.key) {
		case "ArrowUp":
			evt.preventDefault();
			focusAdjacentRow(ctx, row, -1);
			break;
		case "ArrowDown":
			evt.preventDefault();
			focusAdjacentRow(ctx, row, 1);
			break;
		case "ArrowLeft":
		case "ArrowRight": {
			evt.preventDefault();
			cancelHoverCard(ctx);
			const delta = evt.key === "ArrowRight" ? 1 : -1;
			const field = evt.shiftKey ? "desiredQuantity" : "quantity";
			void ctx.manager.adjustItemQuantity(entry.filePath, entry.item.id, field, delta);
			break;
		}
	}
}

/**
 * Have/want quantity stepper: minus button, editable "have" number, plus
 * button, editable "want" number, and the unit label. Clearly marked
 * controls plus arrow-key support (on the row) keep quick adjustments low
 * friction — no modal needed just to bump a count.
 */
export function renderQtyStepper(ctx: RowContext, container: HTMLElement, entry: InventoryEntry): void {
	const { item } = entry;
	const stepper = container.createDiv({ cls: "pantry-qty-stepper pantry-col-qty" });

	const commit = (updates: Partial<InventoryItem>) => {
		cancelHoverCard(ctx);
		ctx.focus.key = rowKey(entry);
		void ctx.manager.updateItem(entry.filePath, item.id, updates);
	};
	const nudge = (delta: number) => {
		cancelHoverCard(ctx);
		ctx.focus.key = rowKey(entry);
		void ctx.manager.adjustItemQuantity(entry.filePath, item.id, "quantity", delta);
	};

	const minus = stepper.createEl("button", {
		cls: "clickable-icon",
		attr: { title: "Decrease quantity on hand" },
	});
	setIcon(minus, "minus");
	minus.addEventListener("click", () => nudge(-1));

	const haveInput = stepper.createEl("input", {
		cls: "pantry-qty-have",
		type: "number",
		attr: { min: "0", step: "1", "aria-label": "Quantity on hand", title: "Have" },
	});
	haveInput.value = String(item.quantity || 0);
	haveInput.addEventListener("change", () =>
		commit({ quantity: Math.max(0, Number(haveInput.value) || 0) }),
	);

	const plus = stepper.createEl("button", {
		cls: "clickable-icon",
		attr: { title: "Increase quantity on hand" },
	});
	setIcon(plus, "plus");
	plus.addEventListener("click", () => nudge(1));

	stepper.createSpan({ cls: "pantry-qty-sep", text: "/" });

	const wantInput = stepper.createEl("input", {
		cls: "pantry-qty-want",
		type: "number",
		attr: { min: "0", step: "1", "aria-label": "Desired quantity", title: "Want" },
	});
	wantInput.value = String(item.desiredQuantity || 0);
	wantInput.addEventListener("change", () =>
		commit({ desiredQuantity: Math.max(0, Number(wantInput.value) || 0) }),
	);
}

/** Renders one item row: status icon, qty stepper, name (+ optional page/section badge), shop links, edit/remove actions. */
export function renderItemRow(
	ctx: RowContext,
	container: HTMLElement,
	entry: InventoryEntry,
	opts: { showLocation: boolean },
): void {
	const { item } = entry;
	const li = container.createEl("li", {
		cls: "pantry-item pantry-item-grid",
		attr: { tabindex: "0" },
	});
	li.dataset.rowKey = rowKey(entry);
	li.draggable = true;

	li.addEventListener("focus", () => {
		ctx.focus.key = rowKey(entry);
	});
	li.addEventListener("keydown", (evt) => onRowKeydown(ctx, evt, li, entry));
	li.addEventListener("mouseenter", () => scheduleHoverCard(ctx, li, entry));
	li.addEventListener("mouseleave", () => cancelHoverCard(ctx));
	li.addEventListener("dragstart", (evt) => {
		cancelHoverCard(ctx);
		const payload: DragPayload = { filePath: entry.filePath, itemId: item.id };
		evt.dataTransfer?.setData(DRAG_ITEM_TYPE, JSON.stringify(payload));
		if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
		li.addClass("is-dragging");
	});
	li.addEventListener("dragend", () => li.removeClass("is-dragging"));

	const status = getItemStatus(item);
	const statusIcon = li.createSpan({ cls: "pantry-item-status pantry-col-status" });
	statusIcon.addClass(getStatusClass(status));
	setIcon(statusIcon, getStatusIcon(status));
	statusIcon.setAttribute("title", getStatusLabel(status));

	renderQtyStepper(ctx, li, entry);

	const nameWrap = li.createDiv({ cls: "pantry-name-wrap pantry-col-name" });
	const nameLine = nameWrap.createDiv({ cls: "pantry-name-line" });
	nameLine.createSpan({ cls: "pantry-name", text: toTitleCase(item.name) });
	if (item.unit) {
		nameLine.createSpan({ cls: "pantry-item-unit", text: item.unit });
	}
	if (opts.showLocation) {
		nameWrap.createSpan({
			cls: "pantry-item-location",
			text: `${entry.pageName} › ${entry.sectionName}`,
		});
	}

	const shopsEl = li.createDiv({ cls: "pantry-shop-links pantry-col-shops" });
	renderShopLinkButtons(shopsEl, item.shopLinks);

	const actions = li.createDiv({ cls: "pantry-item-actions pantry-col-actions" });

	const editBtn = actions.createEl("button", {
		cls: "clickable-icon",
		attr: { title: "Edit item" },
	});
	setIcon(editBtn, "pencil");
	editBtn.addEventListener("click", () => openEditItemModal(ctx.app, ctx.manager, entry));

	const moveBtn = actions.createEl("button", {
		cls: "clickable-icon",
		attr: { title: "Move to another list" },
	});
	setIcon(moveBtn, "send");
	moveBtn.addEventListener("click", (evt) => {
		evt.stopPropagation();
		openMoveMenu(ctx, moveBtn, entry);
	});

	const removeBtn = actions.createEl("button", {
		cls: "clickable-icon pantry-remove",
		attr: { title: "Remove item" },
	});
	setIcon(removeBtn, "trash-2");
	removeBtn.addEventListener("click", () => confirmRemoveItem(ctx.app, ctx.manager, entry));
}

/** Wires a text input + add button (with name auto-complete) that commits on Enter or click. */
export function wireQuickAddRow(
	ctx: RowContext,
	row: HTMLElement,
	placeholder: string,
	onCommit: (name: string) => void,
	withSuggest = false,
): void {
	const input = row.createEl("input", {
		cls: "pantry-quick-add-input",
		type: "text",
		attr: { placeholder },
	});
	if (withSuggest) {
		new StringSuggest(ctx.app, input, () => ctx.manager.getKnownItemNames());
	}
	const commit = () => {
		const name = input.value.trim();
		if (!name) return;
		onCommit(name);
		input.value = "";
		input.focus();
	};
	input.addEventListener("keydown", (evt) => {
		if (evt.key === "Enter") {
			evt.preventDefault();
			commit();
		}
	});
	const addBtn = row.createEl("button", {
		cls: "clickable-icon",
		attr: { title: "Add" },
	});
	setIcon(addBtn, "plus");
	addBtn.addEventListener("click", () => commit());
}

/**
 * Renders one section card: editable name/tags, remove-section button,
 * item rows, and a quick-add row. Shared by the Inventory tab's Manage mode
 * and the standalone per-page view — this is the core "build and populate
 * an inventory page" building block.
 */
export function renderSectionCard(
	ctx: RowContext,
	container: HTMLElement,
	filePath: string,
	pageName: string,
	section: InventorySection,
): void {
	const card = container.createDiv({ cls: "pantry-section-card" });
	wireItemDropTarget(ctx, card, filePath, section.name);
	const header = card.createDiv({ cls: "pantry-section-header" });

	const nameInput = header.createEl("input", {
		cls: "pantry-section-name",
		type: "text",
		attr: { "aria-label": "Section name" },
	});
	nameInput.value = section.name;
	nameInput.addEventListener("change", () => {
		const value = nameInput.value.trim();
		if (value && value !== section.name) {
			void ctx.manager.updateSection(filePath, section.name, { name: value });
		} else {
			nameInput.value = section.name;
		}
	});

	const tagsInput = header.createEl("input", {
		cls: "pantry-section-tags",
		type: "text",
		attr: { placeholder: "Section tags (comma-separated)", "aria-label": "Section tags" },
	});
	tagsInput.value = section.tags.join(", ");
	tagsInput.addEventListener("change", () => {
		const tags = tagsInput.value
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		void ctx.manager.updateSection(filePath, section.name, { tags });
	});

	const removeSectionBtn = header.createEl("button", {
		cls: "clickable-icon pantry-remove",
		attr: { title: "Remove section" },
	});
	setIcon(removeSectionBtn, "trash-2");
	removeSectionBtn.addEventListener("click", () =>
		confirmRemoveSection(ctx.app, ctx.manager, filePath, section.name),
	);

	if (section.items.length === 0) {
		card.createDiv({ cls: "pantry-empty pantry-section-empty", text: "No items yet." });
	} else {
		const list = card.createEl("ul", { cls: "pantry-items" });
		for (const item of section.items) {
			const entry: InventoryEntry = {
				item,
				filePath,
				pageName,
				sectionName: section.name,
				sectionTags: section.tags,
			};
			renderItemRow(ctx, list, entry, { showLocation: false });
		}
	}

	const quickAdd = card.createDiv({ cls: "pantry-quick-add" });
	wireQuickAddRow(
		ctx,
		quickAdd,
		"Add an item… (Enter to add)",
		(name) => {
			void ctx.manager.addItem(filePath, section.name, newInventoryItem(name));
		},
		true,
	);
}
