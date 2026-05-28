import {
	MarkdownRenderer,
	Notice,
	TextFileView,
	TFile,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import { setRecipeSelection, stampRecipeCooked } from "../grocery/selection";
import { isHighGi, parseGiDictionary } from "../parser/glycemic";
import { parseIngredientLine } from "../parser/ingredient";
import { detectMeatTemp, MeatTemp } from "../parser/meat";
import { formatQuantity } from "../parser/quantity";
import {
	splitBodyAroundIngredients,
	splitBodyAroundInstructions,
	stripFrontmatter,
} from "../parser/recipe";
import {
	formatMinutes,
	matchingAllergens,
	readAllergens,
	readDiet,
	readFavorite,
	readTimes,
	RecipeTimes,
} from "../parser/recipe-meta";
import {
	PantrySettings,
	RECIPE_FRONTMATTER,
} from "../settings";
import { MarkCookedModal } from "./mark-cooked-modal";

export const VIEW_TYPE_RECIPE = "pantry-recipe";

interface RecipeViewDeps {
	getSettings: () => PantrySettings;
	openInMarkdown: (leaf: WorkspaceLeaf) => Promise<void>;
	onSelectionChanged: () => void;
}

interface NutritionField {
	key: keyof typeof RECIPE_FRONTMATTER;
	label: string;
	aliases: readonly string[];
}

const NUTRITION_FIELDS: NutritionField[] = [
	{
		key: "calories",
		label: "Cal",
		aliases: ["kcal", "calorie", "energy"],
	},
	{ key: "protein", label: "Protein", aliases: ["proteins"] },
	{
		key: "fat",
		label: "Fat",
		aliases: ["fats", "total fat", "totalfat", "total_fat"],
	},
	{
		key: "carbs",
		label: "Carbs",
		aliases: ["carb", "carbohydrate", "carbohydrates", "net carbs"],
	},
];

const SERVINGS_KEYS = [
	RECIPE_FRONTMATTER.servings,
	"serves",
	"serving",
	"yield",
	"portions",
] as const;

/**
 * Replacement view for markdown files that represent recipes.
 *
 * Uses the file's frontmatter for metadata (image, multiplier, servings,
 * nutrition) and renders the body in three pieces: anything before the
 * ingredients heading, an interactive ingredients list with scaled
 * quantities, and anything after.
 */
export class RecipeView extends TextFileView {
	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: RecipeViewDeps,
	) {
		super(leaf);
		this.icon = "chef-hat";
		this.navigation = true;

		this.addAction("file-text", "Edit as Markdown", () => {
			void this.deps.openInMarkdown(this.leaf);
		});
	}

	getViewType(): string {
		return VIEW_TYPE_RECIPE;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "Recipe";
	}

	getViewData(): string {
		return this.data;
	}

	setViewData(data: string, _clear: boolean): void {
		this.data = data;
		this.render();
	}

	clear(): void {
		this.data = "";
		this.contentEl.empty();
	}

	async onLoadFile(file: TFile): Promise<void> {
		await super.onLoadFile(file);
		this.registerEvent(
			this.app.metadataCache.on("changed", (changed) => {
				if (this.file && changed.path === this.file.path) {
					this.render();
				}
			}),
		);
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("pantry-recipe-view");

		const file = this.file;
		if (!file) return;

		const settings = this.deps.getSettings();
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = (cache?.frontmatter ?? {}) as Record<
			string,
			unknown
		>;

		const multiplier =
			readNumericFromKeys(frontmatter, [
				RECIPE_FRONTMATTER.multiplier,
			]) ?? 1;
		const servings = readNumericFromKeys(frontmatter, SERVINGS_KEYS);
		const isSelected = isTruthy(
			frontmatter[settings.selectionProperty],
		);

		const body = stripFrontmatter(this.data);
		const split = splitBodyAroundIngredients(
			body,
			settings.ingredientsHeading,
		);

		const diet = readDiet(frontmatter);
		const allergens = readAllergens(frontmatter);
		const times = readTimes(frontmatter);
		const isFavorite = readFavorite(frontmatter);
		const allergenWarnings = matchingAllergens(
			allergens,
			settings.myAllergens,
		);

		this.renderTitle(root, file, diet, times);
		if (allergenWarnings.length > 0) {
			this.renderAllergenWarning(root, allergenWarnings);
		}
		this.renderMetaBanner(
			root,
			file,
			frontmatter,
			multiplier,
			servings,
			isSelected,
			isFavorite,
			settings,
		);

		if (split.before.trim()) {
			void this.renderMarkdown(root, split.before, file.path);
		}

		const bodyRow = root.createDiv({
			cls: "pantry-recipe-body",
		});

		const ingredientsCol = bodyRow.createDiv({
			cls: "pantry-recipe-body-main",
		});
		if (split.ingredientLines.length > 0) {
			this.renderIngredients(
				ingredientsCol,
				split.ingredientLines,
				multiplier,
				settings,
			);
		}

		this.renderImageCard(bodyRow, file, frontmatter);

		this.renderAfterIngredients(
			root,
			split.after,
			file.path,
			settings.instructionsHeading,
		);
	}

	private renderAfterIngredients(
		root: HTMLElement,
		afterMarkdown: string,
		sourcePath: string,
		instructionsHeading: string,
	): void {
		if (!afterMarkdown.trim()) return;

		const split = splitBodyAroundInstructions(
			afterMarkdown,
			instructionsHeading,
		);

		if (split.steps.length === 0) {
			void this.renderMarkdown(root, afterMarkdown, sourcePath);
			return;
		}

		if (split.before.trim()) {
			void this.renderMarkdown(root, split.before, sourcePath);
		}

		this.renderInstructions(
			root,
			split.steps,
			sourcePath,
			instructionsHeading,
		);

		if (split.after.trim()) {
			void this.renderMarkdown(root, split.after, sourcePath);
		}
	}

	private renderInstructions(
		root: HTMLElement,
		steps: string[],
		sourcePath: string,
		title: string,
	): void {
		const wrap = root.createDiv({
			cls: "pantry-recipe-instructions",
		});

		const header = wrap.createDiv({
			cls: "pantry-recipe-instructions-header",
		});
		const headerIcon = header.createSpan({
			cls: "pantry-recipe-instructions-icon",
		});
		setIcon(headerIcon, "list-ordered");
		header.createEl("h2", {
			cls: "pantry-recipe-instructions-title",
			text: title,
		});

		const list = wrap.createEl("ol", {
			cls: "pantry-recipe-instruction-list",
		});

		for (let i = 0; i < steps.length; i++) {
			const step = steps[i] ?? "";
			const li = list.createEl("li", {
				cls: "pantry-recipe-instruction",
			});
			li.createDiv({
				cls: "pantry-recipe-instruction-number",
				text: String(i + 1),
			});
			const body = li.createDiv({
				cls: "pantry-recipe-instruction-body",
			});
			void MarkdownRenderer.render(this.app, step, body, sourcePath, this);
		}
	}

	private renderImageCard(
		root: HTMLElement,
		file: TFile,
		frontmatter: Record<string, unknown>,
	): void {
		const card = root.createDiv({
			cls: "pantry-recipe-image-card",
		});

		const raw = readStringFromKeys(frontmatter, IMAGE_KEYS);
		const url = raw ? this.resolveImage(raw, file) : null;

		if (!url) {
			this.renderImagePlaceholder(card);
			return;
		}

		const img = card.createEl("img", {
			cls: "pantry-recipe-image",
			attr: { alt: file.basename, src: url },
		});
		img.addEventListener("error", () => {
			img.remove();
			this.renderImagePlaceholder(card);
		});
	}

	private renderImagePlaceholder(card: HTMLElement): void {
		card.addClass("is-placeholder");
		const inner = card.createDiv({
			cls: "pantry-recipe-image-placeholder",
		});
		const icon = inner.createSpan({
			cls: "pantry-recipe-image-placeholder-icon",
		});
		setIcon(icon, "image-off");
		inner.createDiv({
			cls: "pantry-recipe-image-placeholder-text",
			text: "No image",
		});
	}

	private resolveImage(value: string, file: TFile): string | null {
		const trimmed = value.trim();
		if (!trimmed) return null;

		if (/^(https?:|data:|app:|capacitor:)/i.test(trimmed)) {
			return trimmed;
		}

		const wikilink = trimmed.match(/^!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/);
		const target = ((wikilink ? wikilink[1] : trimmed) ?? trimmed).trim();

		const linked = this.app.metadataCache.getFirstLinkpathDest(
			target,
			file.path,
		);
		if (linked) {
			return this.app.vault.getResourcePath(linked);
		}
		const direct = this.app.vault.getAbstractFileByPath(target);
		if (direct instanceof TFile) {
			return this.app.vault.getResourcePath(direct);
		}
		return null;
	}

	private renderTitle(
		root: HTMLElement,
		file: TFile,
		diet: readonly string[],
		times: RecipeTimes,
	): void {
		const header = root.createDiv({ cls: "pantry-recipe-title-block" });
		header.createEl("h1", {
			cls: "pantry-recipe-title",
			text: file.basename,
		});

		const hasBadges =
			diet.length > 0 ||
			times.prep !== null ||
			times.cook !== null ||
			times.total !== null;
		if (!hasBadges) return;

		const badges = header.createDiv({ cls: "pantry-recipe-badges" });

		for (const tag of diet) {
			const badge = badges.createSpan({
				cls: "pantry-badge pantry-badge-diet",
				text: tag,
			});
			badge.setAttribute("title", `Diet: ${tag}`);
		}

		this.renderTimeBadge(badges, "Prep", times.prep);
		this.renderTimeBadge(badges, "Cook", times.cook);
		// Only show Total when neither prep nor cook is present (otherwise
		// Total is just their sum and would be redundant noise).
		if (times.prep === null && times.cook === null) {
			this.renderTimeBadge(badges, "Total", times.total);
		}
	}

	private renderTimeBadge(
		row: HTMLElement,
		label: string,
		minutes: number | null,
	): void {
		if (minutes === null) return;
		const badge = row.createSpan({
			cls: "pantry-badge pantry-badge-time",
		});
		const icon = badge.createSpan({ cls: "pantry-badge-icon" });
		setIcon(icon, "clock");
		badge.createSpan({
			cls: "pantry-badge-label",
			text: `${label}`,
		});
		badge.createSpan({
			cls: "pantry-badge-value",
			text: formatMinutes(minutes),
		});
		badge.setAttribute("title", `${label} time: ${formatMinutes(minutes)}`);
	}

	private renderAllergenWarning(
		root: HTMLElement,
		matches: readonly string[],
	): void {
		const banner = root.createDiv({
			cls: "pantry-recipe-allergen-warning",
			attr: { role: "alert" },
		});
		const icon = banner.createSpan({
			cls: "pantry-recipe-allergen-warning-icon",
		});
		setIcon(icon, "alert-octagon");
		const body = banner.createDiv({
			cls: "pantry-recipe-allergen-warning-body",
		});
		body.createDiv({
			cls: "pantry-recipe-allergen-warning-title",
			text: "Allergen warning",
		});
		body.createDiv({
			cls: "pantry-recipe-allergen-warning-text",
			text: `Contains ${matches.join(", ")}.`,
		});
	}

	private async toggleSelection(
		file: TFile,
		selected: boolean,
		settings: PantrySettings,
	): Promise<void> {
		await setRecipeSelection(this.app, file, selected, settings);
	}

	private renderMetaBanner(
		root: HTMLElement,
		file: TFile,
		frontmatter: Record<string, unknown>,
		multiplier: number,
		servings: number | null,
		isSelected: boolean,
		isFavorite: boolean,
		settings: PantrySettings,
	): void {
		const banner = root.createDiv({
			cls: "pantry-recipe-meta-banner",
		});
		const cells = banner.createDiv({
			cls: "pantry-recipe-meta-cells",
		});

		this.renderMultiplierCell(cells, file, multiplier);
		this.renderServingsCell(cells, servings, multiplier);
		for (const field of NUTRITION_FIELDS) {
			this.renderNutritionCell(
				cells,
				field,
				frontmatter,
				servings,
				settings.nutritionSource,
				settings.nutritionDisplay,
			);
		}

		const actions = banner.createDiv({
			cls: "pantry-recipe-meta-actions",
		});
		this.renderFavoriteToggle(actions, file, isFavorite);
		if (settings.showMarkCookedButton) {
			this.renderMarkCookedButton(actions, file, settings);
		}
		this.renderCartToggle(actions, file, isSelected, settings);
	}

	private renderFavoriteToggle(
		actions: HTMLElement,
		file: TFile,
		isFavorite: boolean,
	): void {
		const toggle = actions.createEl("button", {
			cls: "pantry-recipe-favorite-toggle",
			attr: { type: "button" },
		});
		let state = isFavorite;
		const update = (favorite: boolean): void => {
			state = favorite;
			toggle.toggleClass("is-favorite", favorite);
			toggle.setAttribute("aria-pressed", favorite ? "true" : "false");
			const label = favorite ? "Remove favorite" : "Mark as favorite";
			toggle.setAttribute("aria-label", label);
			toggle.title = label;
			toggle.empty();
			setIcon(toggle, "star");
		};
		update(isFavorite);

		toggle.addEventListener("click", () => {
			const next = !state;
			void this.setFavorite(file, next).then(() => {
				update(next);
			});
		});
	}

	private async setFavorite(file: TFile, next: boolean): Promise<void> {
		await this.app.fileManager.processFrontMatter(
			file,
			(fm: Record<string, unknown>) => {
				if (next) {
					fm[RECIPE_FRONTMATTER.favorite] = true;
				} else {
					delete fm[RECIPE_FRONTMATTER.favorite];
				}
			},
		);
	}

	private renderMarkCookedButton(
		actions: HTMLElement,
		file: TFile,
		settings: PantrySettings,
	): void {
		const btn = actions.createEl("button", {
			cls: "pantry-recipe-mark-cooked-button",
			attr: { type: "button", "aria-label": "Mark as cooked", title: "Mark as cooked" },
		});
		setIcon(btn, "chef-hat");

		btn.addEventListener("click", () => {
			if (settings.markCookedAskDate) {
				new MarkCookedModal(this.app, (date) =>
					this.markAsCooked(file, date, settings),
				).open();
			} else {
				const today = localDateISO();
				void this.markAsCooked(file, today, settings);
			}
		});
	}

	private async markAsCooked(
		file: TFile,
		date: string,
		settings: PantrySettings,
	): Promise<void> {
		const { newCount } = await stampRecipeCooked(this.app, file, date, settings);
		if (newCount !== null) {
			new Notice(`Marked "${file.basename}" as cooked. Total: ${newCount} time${newCount === 1 ? "" : "s"}.`);
		} else {
			new Notice(`Marked "${file.basename}" as cooked.`);
		}
	}

	private renderCartToggle(
		actions: HTMLElement,
		file: TFile,
		isSelected: boolean,
		settings: PantrySettings,
	): void {
		const toggle = actions.createEl("button", {
			cls: "pantry-recipe-cart-toggle",
			attr: { type: "button" },
		});
		let selectedState = isSelected;
		const updateToggle = (selected: boolean): void => {
			selectedState = selected;
			toggle.toggleClass("is-selected", selected);
			toggle.setAttribute("aria-pressed", selected ? "true" : "false");
			const label = selected
				? "Remove from grocery list"
				: "Add to grocery list";
			toggle.setAttribute("aria-label", label);
			toggle.title = label;
			toggle.empty();
			setIcon(toggle, "shopping-cart");
		};
		updateToggle(isSelected);

		toggle.addEventListener("click", () => {
			const next = !selectedState;
			void this.toggleSelection(file, next, settings).then(() => {
				updateToggle(next);
				this.deps.onSelectionChanged();
			});
		});
	}

	private renderMultiplierCell(
		grid: HTMLElement,
		file: TFile,
		multiplier: number,
	): void {
		const cell = grid.createDiv({
			cls: "pantry-recipe-meta-cell",
		});
		const main = cell.createDiv({
			cls: "pantry-recipe-meta-cell-main",
		});

		const stepper = main.createDiv({
			cls: "pantry-recipe-stepper",
			attr: { "aria-label": "Recipe multiplier" },
		});

		const minus = stepper.createEl("button", {
			cls: "pantry-recipe-stepper-button",
			text: "\u2212",
			attr: { type: "button", "aria-label": "Decrease multiplier" },
		});
		minus.addEventListener("click", () => {
			void this.updateMultiplier(file, multiplier - 0.5);
		});

		const input = stepper.createEl("input", {
			cls: "pantry-recipe-stepper-input",
			type: "number",
		});
		input.value = formatNumberValue(multiplier);
		input.step = "0.5";
		input.min = "0.5";
		input.addEventListener("change", () => {
			const next = Number(input.value);
			if (Number.isFinite(next) && next > 0) {
				void this.updateMultiplier(file, next);
			} else {
				input.value = formatNumberValue(multiplier);
			}
		});

		const plus = stepper.createEl("button", {
			cls: "pantry-recipe-stepper-button",
			text: "+",
			attr: { type: "button", "aria-label": "Increase multiplier" },
		});
		plus.addEventListener("click", () => {
			void this.updateMultiplier(file, multiplier + 0.5);
		});
	}

	private async updateMultiplier(file: TFile, value: number): Promise<void> {
		const next = Math.max(0.5, Math.round(value * 100) / 100);
		await this.app.fileManager.processFrontMatter(
			file,
			(fm: Record<string, unknown>) => {
				if (next === 1) {
					delete fm[RECIPE_FRONTMATTER.multiplier];
				} else {
					fm[RECIPE_FRONTMATTER.multiplier] = next;
				}
			},
		);
		this.deps.onSelectionChanged();
	}

	private renderServingsCell(
		grid: HTMLElement,
		baseServings: number | null,
		multiplier: number,
	): void {
		const cell = grid.createDiv({
			cls: "pantry-recipe-meta-cell",
		});
		const main = cell.createDiv({
			cls: "pantry-recipe-meta-cell-main",
		});
		main.createDiv({
			cls: "pantry-recipe-meta-label",
			text: "Serves",
		});

		const total =
			baseServings === null ? null : baseServings * multiplier;
		const value = main.createDiv({
			cls: "pantry-recipe-meta-value",
			text: total === null ? "—" : formatNumberValue(total),
		});
		if (total === null) value.addClass("is-empty");
	}

	private renderNutritionCell(
		container: HTMLElement,
		field: NutritionField,
		frontmatter: Record<string, unknown>,
		baseServings: number | null,
		sourceMode: PantrySettings["nutritionSource"],
		displayMode: PantrySettings["nutritionDisplay"],
	): void {
		const baseValue = readNutritionValue(frontmatter, field);
		const displayValue = resolveNutritionDisplayValue(
			baseValue,
			baseServings,
			sourceMode,
			displayMode,
		);

		const cell = container.createDiv({
			cls: "pantry-recipe-meta-cell",
		});
		const main = cell.createDiv({
			cls: "pantry-recipe-meta-cell-main",
		});
		main.createDiv({
			cls: "pantry-recipe-meta-label",
			text: field.label,
		});

		const valueEl = main.createDiv({
			cls: "pantry-recipe-nutrition-value",
			text: displayValue === null ? "—" : roundForDisplay(displayValue),
		});
		if (displayValue === null) valueEl.addClass("is-empty");
	}

	private renderIngredients(
		root: HTMLElement,
		ingredientLines: string[],
		multiplier: number,
		settings: PantrySettings,
	): void {
		const wrap = root.createDiv({
			cls: "pantry-recipe-ingredients",
		});

		const header = wrap.createDiv({
			cls: "pantry-recipe-ingredients-header",
		});
		const headerIcon = header.createSpan({
			cls: "pantry-recipe-ingredients-icon",
		});
		setIcon(headerIcon, "chef-hat");
		header.createEl("h2", {
			cls: "pantry-recipe-ingredients-title",
			text: settings.ingredientsHeading,
		});

		const ul = wrap.createEl("ul", {
			cls: "pantry-recipe-ingredient-list",
		});

		const giDictionary = settings.diabeticMode
			? parseGiDictionary(settings.giDictionary)
			: [];

		for (const raw of ingredientLines) {
			const parsed = parseIngredientLine(raw);
			if (!parsed) continue;
			const li = ul.createEl("li", {
				cls: "pantry-recipe-ingredient",
			});

			const scaledQty =
				parsed.quantity === null
					? null
					: parsed.quantity * multiplier;
			const qtyText = formatQuantity(scaledQty);
			const qtyDisplay = [qtyText, parsed.unit]
				.filter(Boolean)
				.join(" ");

			const qtyEl = li.createSpan({
				cls: "pantry-recipe-ingredient-qty",
				text: qtyDisplay,
			});
			if (!qtyDisplay) qtyEl.addClass("is-empty");

			li.createSpan({
				cls: "pantry-recipe-ingredient-name",
				text: titleCase(parsed.name),
			});

			const meatTemp = detectMeatTemp(parsed.name);
			if (meatTemp) {
				this.renderMeatTempBadge(li, meatTemp);
			}

			if (settings.diabeticMode && isHighGi(parsed.name, giDictionary)) {
				this.renderHighGiBadge(li);
			}
		}
	}

	private renderHighGiBadge(li: HTMLElement): void {
		const tooltip =
			"High glycemic index - may cause a faster blood-sugar spike.";
		const badge = li.createSpan({
			cls: "pantry-recipe-ingredient-gi",
			attr: {
				role: "note",
				"aria-label": tooltip,
				title: tooltip,
			},
		});
		const icon = badge.createSpan({
			cls: "pantry-recipe-ingredient-gi-icon",
		});
		setIcon(icon, "arrow-up");
		badge.createSpan({
			cls: "pantry-recipe-ingredient-gi-text",
			text: "GI",
		});
	}

	private renderMeatTempBadge(li: HTMLElement, temp: MeatTemp): void {
		const tooltip = `Cook ${temp.category.toLowerCase()} to a safe internal temperature of ${temp.fahrenheit}°F (${temp.celsius}°C).`;
		const badge = li.createSpan({
			cls: "pantry-recipe-ingredient-temp",
			attr: {
				role: "note",
				"aria-label": tooltip,
				title: tooltip,
			},
		});
		const icon = badge.createSpan({
			cls: "pantry-recipe-ingredient-temp-icon",
		});
		setIcon(icon, "alert-triangle");
		badge.createSpan({
			cls: "pantry-recipe-ingredient-temp-text",
			text: `${temp.fahrenheit}°F`,
		});
	}

	private async renderMarkdown(
		root: HTMLElement,
		markdown: string,
		sourcePath: string,
	): Promise<void> {
		const block = root.createDiv({
			cls: "pantry-recipe-markdown",
		});
		await MarkdownRenderer.render(this.app, markdown, block, sourcePath, this);
	}
}

const IMAGE_KEYS = [RECIPE_FRONTMATTER.image] as const;

/**
 * Looks up a string value in a frontmatter object trying several keys
 * case-insensitively. Returns the trimmed string, or null if no key
 * holds a non-empty string.
 */
function readStringFromKeys(
	fm: Record<string, unknown>,
	keys: readonly string[],
): string | null {
	const lookup = new Map<string, unknown>();
	for (const k of Object.keys(fm)) {
		lookup.set(k.toLowerCase(), fm[k]);
	}
	for (const key of keys) {
		const raw = lookup.get(key.toLowerCase());
		if (typeof raw === "string") {
			const trimmed = raw.trim();
			if (trimmed) return trimmed;
		}
	}
	return null;
}

function parseNumericValue(raw: unknown): number | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
	if (typeof raw === "string") {
		const match = raw.trim().match(/^[+-]?\d+(?:[.,]\d+)?/);
		if (!match) return null;
		const n = Number(match[0].replace(",", "."));
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

/**
 * Look up a number from a frontmatter object trying several keys
 * case-insensitively, accepting either bare numbers or strings that begin
 * with a number (so values like "350 kcal" still parse).
 */
function readNumericFromKeys(
	fm: Record<string, unknown>,
	keys: readonly string[],
): number | null {
	const lookup = new Map<string, unknown>();
	for (const k of Object.keys(fm)) {
		lookup.set(k.toLowerCase(), fm[k]);
	}
	for (const key of keys) {
		const parsed = parseNumericValue(lookup.get(key.toLowerCase()));
		if (parsed !== null) return parsed;
	}
	return null;
}

/**
 * Read a nutrition value, looking at the canonical key plus a few common
 * aliases ("fats" for fat, "carbohydrates" for carbs, etc.) and also
 * inside a nested `nutrition: { ... }` block.
 */
function readNutritionValue(
	fm: Record<string, unknown>,
	field: NutritionField,
): number | null {
	const keys = [RECIPE_FRONTMATTER[field.key], ...field.aliases];
	const flat = readNumericFromKeys(fm, keys);
	if (flat !== null) return flat;
	const nested = fm.nutrition;
	if (nested && typeof nested === "object" && !Array.isArray(nested)) {
		return readNumericFromKeys(
			nested as Record<string, unknown>,
			keys,
		);
	}
	return null;
}

function isTruthy(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") {
		const v = value.trim().toLowerCase();
		return v === "true" || v === "yes" || v === "1";
	}
	return false;
}

function formatNumberValue(num: number): string {
	if (Number.isInteger(num)) return String(num);
	return String(Math.round(num * 100) / 100);
}

function roundForDisplay(num: number): string {
	if (Number.isInteger(num)) return String(num);
	const rounded = Math.round(num * 10) / 10;
	if (Math.abs(rounded - Math.round(rounded)) < 0.05) {
		return String(Math.round(rounded));
	}
	return rounded.toFixed(1);
}

function resolveNutritionDisplayValue(
	baseValue: number | null,
	baseServings: number | null,
	sourceMode: PantrySettings["nutritionSource"],
	displayMode: PantrySettings["nutritionDisplay"],
): number | null {
	if (baseValue === null) return null;

	const hasServings =
		baseServings !== null && Number.isFinite(baseServings) && baseServings > 0;
	const perServing =
		sourceMode === "per-serving"
			? baseValue
			: hasServings
				? baseValue / baseServings
				: null;
	const total =
		sourceMode === "recipe-total"
			? baseValue
			: hasServings
				? baseValue * baseServings
				: null;

	if (displayMode === "per-serving") {
		return perServing ?? baseValue;
	}
	return total ?? baseValue;
}

function localDateISO(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function titleCase(name: string): string {
	return name.replace(
		/(^|[\s-])([a-z])/g,
		(_match, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`,
	);
}
