import {
	App,
	FuzzySuggestModal,
	ItemView,
	Modal,
	Notice,
	TFile,
	TFolder,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import {
	formatAutoFillNotice,
	runAutoFillWeek,
} from "../grocery/meal-plan-fill";
import { GroceryListManager } from "../grocery/manager";
import { listRecipeLibrary } from "../grocery/library";
import { setRecipeSelection } from "../grocery/selection";
import {
	emptyGrid,
	MealPlanEntry,
	MealPlanGrid,
	occurrencesToGrid,
	parseMealPlanContents,
	serializeMealPlanGrid,
} from "../parser/meal-plan";
import {
	activeMealDays,
	activeMealSlots,
	PantrySettings,
} from "../settings";

export const VIEW_TYPE_MEAL_PLANNER = "pantry-meal-planner";

/** Drag payload MIME for moving a planned recipe between slots. */
const DRAG_RECIPE_TYPE = "application/x-pantry-planner-recipe";

interface PlannerDragPayload {
	day: string;
	slot: string;
	index: number;
}

interface PlannerDeps {
	manager: GroceryListManager;
	getSettings: () => PantrySettings;
	saveSettings: () => Promise<void>;
}

/**
 * Week-grid planner. Reads and writes a single meal-plan note (the same
 * format the grocery list imports), giving users without their own
 * automation a way to assign recipes to Breakfast/Lunch/Dinner/Snacks
 * slots across the week.
 */
export class MealPlannerView extends ItemView {
	private grid: MealPlanGrid;
	private bodyEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private addToListBtn!: HTMLButtonElement;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: PlannerDeps,
	) {
		super(leaf);
		this.icon = "calendar-days";
		this.navigation = true;
		this.grid = emptyGrid(
			activeMealDays(deps.getSettings()),
			activeMealSlots(deps.getSettings()),
		);
	}

	getViewType(): string {
		return VIEW_TYPE_MEAL_PLANNER;
	}

	getDisplayText(): string {
		return "Meal planner";
	}

	async onOpen(): Promise<void> {
		const root = this.containerEl.children[1];
		if (!root) return;
		root.empty();
		root.addClass("pantry-planner");

		const header = root.createDiv({ cls: "pantry-planner-header" });
		const titleWrap = header.createDiv({
			cls: "pantry-planner-titlewrap",
		});
		titleWrap.createDiv({
			cls: "pantry-planner-title",
			text: "Meal planner",
		});
		this.summaryEl = titleWrap.createDiv({
			cls: "pantry-planner-summary",
		});

		const actions = header.createDiv({ cls: "pantry-planner-actions" });

		const autoFillBtn = actions.createEl("button", {
			cls: "pantry-planner-autofill",
			attr: { type: "button" },
		});
		autoFillBtn.createSpan({ text: "Auto-fill empty slots" });
		autoFillBtn.addEventListener("click", () => {
			void this.autoFillEmptySlots();
		});

		this.addToListBtn = actions.createEl("button", {
			cls: "mod-cta pantry-planner-cta",
			attr: { type: "button" },
		});
		const cartIcon = this.addToListBtn.createSpan({
			cls: "pantry-planner-cta-icon",
		});
		setIcon(cartIcon, "shopping-cart");
		this.addToListBtn.createSpan({ text: "Add to grocery list" });
		this.addToListBtn.addEventListener("click", () => {
			void this.addToGroceryList();
		});

		this.bodyEl = root.createDiv({ cls: "pantry-planner-body" });

		await this.loadGrid();
		this.render();
	}

	onClose(): Promise<void> {
		return Promise.resolve();
	}

	/** Reload the plan note from disk and re-render (e.g. after a command-side auto-fill). */
	async reloadFromDisk(): Promise<void> {
		await this.loadGrid();
		this.render();
	}

	private async autoFillEmptySlots(): Promise<void> {
		const result = await runAutoFillWeek(this.app, {
			getSettings: () => this.deps.getSettings(),
			saveSettings: () => this.deps.saveSettings(),
			manager: this.deps.manager,
		});
		await this.reloadFromDisk();
		new Notice(formatAutoFillNotice(result));
	}

	/** Load the configured note (if any) into the grid. */
	private async loadGrid(): Promise<void> {
		const settings = this.deps.getSettings();
		const slots = activeMealSlots(settings);
		const days = activeMealDays(settings);
		const file = this.planFile();
		if (!file) {
			this.grid = emptyGrid(days, slots);
			return;
		}
		try {
			const contents = await this.app.vault.cachedRead(file);
			const { occurrences } = parseMealPlanContents(
				this.app,
				file.path,
				contents,
				settings,
			);
			this.grid = occurrencesToGrid(occurrences, days, slots);
		} catch (err) {
			console.error("pantry: failed to load meal plan", err);
			this.grid = emptyGrid(days, slots);
		}
	}

	private planFile(): TFile | null {
		const path = this.deps.getSettings().mealPlanNotePath.trim();
		if (!path) return null;
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	private render(): void {
		this.renderSummary();
		this.bodyEl.empty();

		const grid = this.bodyEl.createDiv({ cls: "pantry-planner-grid" });
		const today = currentWeekday();
		for (const day of this.grid.days) {
			this.renderDay(grid, day, day === today);
		}
	}

	private renderSummary(): void {
		this.summaryEl.empty();
		const settings = this.deps.getSettings();
		const total = this.totalRecipes();

		this.summaryEl.createSpan({
			text:
				total === 0
					? "No meals planned yet"
					: `${total} meal${total === 1 ? "" : "s"} planned`,
		});

		const path = settings.mealPlanNotePath.trim();
		if (path) {
			this.summaryEl.createSpan({
				cls: "pantry-planner-path",
				text: ` · ${path}`,
			});
		}

		if (settings.mealPlanEnabled) {
			this.summaryEl.createSpan({
				cls: "pantry-planner-sync",
				text: " · auto-syncing to grocery list",
			});
		}

		this.addToListBtn.disabled = this.uniquePlannedFiles().length === 0;
	}

	private renderDay(
		parent: HTMLElement,
		day: string,
		isToday: boolean,
	): void {
		const card = parent.createDiv({ cls: "pantry-planner-day" });
		if (isToday) card.addClass("is-today");

		const nameRow = card.createDiv({ cls: "pantry-planner-day-head" });
		nameRow.createDiv({ cls: "pantry-planner-day-name", text: day });
		if (isToday) {
			nameRow.createSpan({
				cls: "pantry-planner-today-badge",
				text: "Today",
			});
		}

		for (const slot of this.grid.slots) {
			const slotEl = card.createDiv({ cls: "pantry-planner-slot" });
			slotEl.createSpan({
				cls: "pantry-planner-slot-name",
				text: slot,
			});

			const entries = this.grid.cells[day]?.[slot] ?? [];
			const list = slotEl.createDiv({ cls: "pantry-planner-chips" });
			this.wireSlotDropTarget(list, day, slot);
			entries.forEach((entry, index) => {
				this.renderChip(list, day, slot, entry, index);
			});

			const actions = list.createDiv({ cls: "pantry-planner-add" });
			const add = actions.createEl("button", {
				cls: "pantry-planner-empty",
				text: entries.length === 0 ? "Add a recipe" : "Add another",
				attr: {
					type: "button",
					"aria-label": `Add a recipe to ${day} ${slot}`,
				},
			});
			add.addEventListener("click", () => {
				this.openPicker(day, slot);
			});
			const addNote = actions.createEl("button", {
				cls: "pantry-planner-empty",
				text: "Add a note",
				attr: {
					type: "button",
					"aria-label": `Add a note to ${day} ${slot}`,
				},
			});
			addNote.addEventListener("click", () => {
				this.openNoteModal(day, slot);
			});
		}
	}

	private openPicker(day: string, slot: string): void {
		new RecipePickerModal(this.app, this.deps.getSettings, (file) => {
			void this.addRecipe(day, slot, file);
		}).open();
	}

	private openNoteModal(day: string, slot: string): void {
		new PlanNoteModal(this.app, (text) => {
			void this.addNote(day, slot, text);
		}).open();
	}

	private renderChip(
		parent: HTMLElement,
		day: string,
		slot: string,
		entry: MealPlanEntry,
		index: number,
	): void {
		const chip = parent.createDiv({ cls: "pantry-planner-chip" });
		chip.draggable = true;
		chip.setAttribute("title", "Drag to another day or meal");
		chip.addEventListener("dragstart", (evt) => {
			const payload: PlannerDragPayload = { day, slot, index };
			evt.dataTransfer?.setData(
				DRAG_RECIPE_TYPE,
				JSON.stringify(payload),
			);
			if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
			chip.addClass("is-dragging");
		});
		chip.addEventListener("dragend", () => {
			chip.removeClass("is-dragging");
		});

		if (entry.kind === "recipe") {
			const link = chip.createEl("a", {
				cls: "pantry-planner-chip-link",
				text: entry.file.basename,
				href: "#",
			});
			link.addEventListener("click", (evt) => {
				evt.preventDefault();
				void this.app.workspace.getLeaf(false).openFile(entry.file);
			});
		} else {
			chip.addClass("is-note");
			chip.createSpan({
				cls: "pantry-planner-chip-note",
				text: entry.text,
				attr: { title: entry.text },
			});
		}
		const remove = chip.createEl("button", {
			cls: "clickable-icon pantry-planner-chip-remove",
			attr: { type: "button", "aria-label": "Remove" },
		});
		setIcon(remove, "x");
		remove.addEventListener("click", () => {
			void this.removeRecipe(day, slot, index);
		});
	}

	/** Accept chips dragged from any planner slot and reschedule them here. */
	private wireSlotDropTarget(
		el: HTMLElement,
		targetDay: string,
		targetSlot: string,
	): void {
		el.addEventListener("dragover", (evt) => {
			if (!evt.dataTransfer?.types.includes(DRAG_RECIPE_TYPE)) return;
			evt.preventDefault();
			evt.dataTransfer.dropEffect = "move";
			el.addClass("is-drop-target");
		});
		el.addEventListener("dragleave", (evt) => {
			if (evt.relatedTarget instanceof Node && el.contains(evt.relatedTarget)) {
				return;
			}
			el.removeClass("is-drop-target");
		});
		el.addEventListener("drop", (evt) => {
			evt.preventDefault();
			el.removeClass("is-drop-target");
			const raw = evt.dataTransfer?.getData(DRAG_RECIPE_TYPE);
			if (!raw) return;
			let payload: PlannerDragPayload;
			try {
				payload = JSON.parse(raw) as PlannerDragPayload;
			} catch {
				return;
			}
			if (
				typeof payload.day !== "string" ||
				typeof payload.slot !== "string" ||
				typeof payload.index !== "number"
			) {
				return;
			}
			void this.moveRecipe(
				payload.day,
				payload.slot,
				payload.index,
				targetDay,
				targetSlot,
			);
		});
	}

	private totalRecipes(): number {
		let n = 0;
		for (const day of this.grid.days) {
			for (const slot of this.grid.slots) {
				n += this.grid.cells[day]?.[slot]?.length ?? 0;
			}
		}
		return n;
	}

	/** Distinct recipe files across every day and slot, keyed by path. */
	private uniquePlannedFiles(): TFile[] {
		const byPath = new Map<string, TFile>();
		for (const day of this.grid.days) {
			for (const slot of this.grid.slots) {
				for (const entry of this.grid.cells[day]?.[slot] ?? []) {
					if (entry.kind !== "recipe") continue;
					byPath.set(entry.file.path, entry.file);
				}
			}
		}
		return [...byPath.values()];
	}

	/**
	 * One-time push: flag each planned recipe's selection property so it
	 * joins the grocery list, independent of the live "auto-sync" toggle.
	 */
	private async addToGroceryList(): Promise<void> {
		const files = this.uniquePlannedFiles();
		if (files.length === 0) {
			new Notice("Add some meals to the plan first.");
			return;
		}

		const settings = this.deps.getSettings();
		this.addToListBtn.disabled = true;
		try {
			for (const file of files) {
				await setRecipeSelection(this.app, file, true, settings);
			}
			await this.deps.manager.refresh();
			new Notice(
				`Added ${files.length} recipe${files.length === 1 ? "" : "s"} from your plan to the grocery list.`,
			);
		} catch (err) {
			console.error("pantry: failed to add plan to grocery list", err);
			new Notice("Couldn't add the plan to the grocery list.");
		} finally {
			this.addToListBtn.disabled = false;
		}
	}

	private async addRecipe(
		day: string,
		slot: string,
		file: TFile,
	): Promise<void> {
		this.grid.cells[day]?.[slot]?.push({ kind: "recipe", file });
		await this.persist();
		this.render();
	}

	private async addNote(day: string, slot: string, text: string): Promise<void> {
		const note = text.replace(/\s+/g, " ").trim().slice(0, 240);
		if (!note) return;
		this.grid.cells[day]?.[slot]?.push({ kind: "note", text: note });
		await this.persist();
		this.render();
	}

	private async removeRecipe(
		day: string,
		slot: string,
		index: number,
	): Promise<void> {
		this.grid.cells[day]?.[slot]?.splice(index, 1);
		await this.persist();
		this.render();
	}

	/** Move a planned recipe from one cell to another (drag-and-drop). */
	private async moveRecipe(
		fromDay: string,
		fromSlot: string,
		index: number,
		toDay: string,
		toSlot: string,
	): Promise<void> {
		if (fromDay === toDay && fromSlot === toSlot) return;
		const source = this.grid.cells[fromDay]?.[fromSlot];
		const target = this.grid.cells[toDay]?.[toSlot];
		if (!source || !target) return;
		if (index < 0 || index >= source.length) return;
		const [entry] = source.splice(index, 1);
		if (!entry) return;
		target.push(entry);
		await this.persist();
		this.render();
	}

	/**
	 * Write the grid to the note. When live auto-sync is enabled we also
	 * refresh the grocery list; otherwise the plan stays decoupled from the
	 * list until the user presses "Add to grocery list".
	 */
	private async persist(): Promise<void> {
		const settings = this.deps.getSettings();
		const file = await this.ensurePlanFile();
		const contents = serializeMealPlanGrid(
			this.app,
			file.path,
			this.grid,
			file.basename,
		);
		await this.app.vault.modify(file, contents);
		if (settings.mealPlanEnabled) {
			await this.deps.manager.refresh();
		}
	}

	/** Resolve the plan note, creating it (and any parent folders) if needed. */
	private async ensurePlanFile(): Promise<TFile> {
		const settings = this.deps.getSettings();
		let path = settings.mealPlanNotePath.trim();
		if (!path) {
			path = "meal-plan.md";
			settings.mealPlanNotePath = path;
			await this.deps.saveSettings();
		}
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;

		await this.ensureParentFolder(path);
		const initial = serializeMealPlanGrid(
			this.app,
			path,
			this.grid,
			basenameFromPath(path),
		);
		return this.app.vault.create(path, initial);
	}

	private async ensureParentFolder(path: string): Promise<void> {
		const slash = path.lastIndexOf("/");
		if (slash === -1) return;
		const dir = path.slice(0, slash);
		if (!dir) return;
		const existing = this.app.vault.getAbstractFileByPath(dir);
		if (existing instanceof TFolder) return;
		try {
			await this.app.vault.createFolder(dir);
		} catch {
			// Folder may already exist or be created concurrently; ignore.
		}
	}
}

function basenameFromPath(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return name.endsWith(".md") ? name.slice(0, -3) : name;
}

/** Full English weekday name for today, matching MEAL_PLAN_DAYS entries. */
function currentWeekday(): string {
	return new Date().toLocaleDateString("en-US", { weekday: "long" });
}

/** Fuzzy picker over the recipe library used to fill planner slots. */
class RecipePickerModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly getSettings: () => PantrySettings,
		private readonly onChoose: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder("Pick a recipe…");
	}

	getItems(): TFile[] {
		return listRecipeLibrary(this.app, this.getSettings())
			.map((entry) => entry.file)
			.sort((a, b) =>
				a.basename.localeCompare(b.basename, undefined, {
					sensitivity: "base",
				}),
			);
	}

	getItemText(file: TFile): string {
		return file.basename;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
		new Notice(`Added "${file.basename}" to the plan.`);
	}
}

/** Single-line meal note, such as eating out, with no recipe behind it. */
class PlanNoteModal extends Modal {
	constructor(
		app: App,
		private readonly onSubmit: (text: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText("Add a note");
		contentEl.createEl("p", {
			text: "A note stays on the plan and is left off the grocery list.",
		});
		const input = contentEl.createEl("input", {
			cls: "pantry-plan-note-input",
			attr: { type: "text", placeholder: "Going out to dinner" },
		});
		const actions = contentEl.createDiv({ cls: "pantry-modal-actions" });
		actions
			.createEl("button", { text: "Cancel", attr: { type: "button" } })
			.addEventListener("click", () => this.close());
		const add = actions.createEl("button", {
			text: "Add note",
			cls: "mod-cta",
			attr: { type: "button" },
		});
		const submit = (): void => {
			const text = input.value.trim();
			if (!text) return;
			this.onSubmit(text);
			this.close();
		};
		add.addEventListener("click", submit);
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				submit();
			}
		});
		window.setTimeout(() => input.focus(), 0);
	}
}
