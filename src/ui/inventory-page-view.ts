import {
	EventRef,
	ItemView,
	TFile,
	ViewStateResult,
	WorkspaceLeaf,
} from "obsidian";
import { InventoryManager } from "../grocery/inventory-manager";
import { RowContext, renderSectionCard, restoreFocus, runWrite, wireQuickAddRow } from "./inventory-item-row";
import { ConfirmModal } from "./confirm-modal";

export const VIEW_TYPE_INVENTORY_PAGE = "pantry-inventory-page";

interface InventoryPageViewDeps {
	manager: InventoryManager;
	openInMarkdown: (leaf: WorkspaceLeaf) => Promise<void>;
}

interface InventoryPageViewState {
	file?: string;
}

/**
 * Standalone, single-file view for one inventory page: the same section
 * cards / item rows / quick-add used by the Inventory tab's Manage mode,
 * scoped to just this note. Lets a page be built and populated without
 * needing to go through the Inventory tab at all — open the note, add
 * sections and items directly.
 */
export class InventoryPageView extends ItemView {
	private filePath: string | null = null;
	private changedRef: EventRef | null = null;
	private bodyEl!: HTMLElement;
	private rowCtx!: RowContext;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: InventoryPageViewDeps,
	) {
		super(leaf);
		this.icon = "archive";
		this.navigation = true;

		this.addAction("file-text", "Edit as Markdown", () => {
			void this.deps.openInMarkdown(this.leaf);
		});
		this.addAction("trash-2", "Delete this page", () => this.confirmDeletePage());
	}

	getViewType(): string {
		return VIEW_TYPE_INVENTORY_PAGE;
	}

	getDisplayText(): string {
		const page = this.filePath ? this.deps.manager.getPage(this.filePath) : undefined;
		return page?.file.basename ?? "Inventory page";
	}

	getState(): Record<string, unknown> {
		return { file: this.filePath ?? undefined };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const path = (state as InventoryPageViewState | undefined)?.file;
		if (typeof path === "string") {
			this.filePath = path;
		}
		await super.setState(state, result);
		this.render();
	}

	async onOpen(): Promise<void> {
		const root = this.containerEl.children[1];
		if (!root) return;
		root.empty();
		root.addClass("pantry-view", "pantry-inventory-page-view");

		this.bodyEl = root.createDiv({ cls: "pantry-inventory-list" });

		const hoverCardEl = document.body.createDiv({ cls: "pantry-hover-card" });
		hoverCardEl.addClass("is-hidden");
		this.rowCtx = {
			app: this.app,
			manager: this.deps.manager,
			hoverCardEl,
			hover: { timer: null },
			focus: { key: null },
			getScopeEl: () => this.bodyEl,
		};

		this.changedRef = this.deps.manager.on("changed", () => this.render());
		this.render();
	}

	onClose(): Promise<void> {
		if (this.changedRef) this.deps.manager.offref(this.changedRef);
		if (this.rowCtx.hover.timer !== null) window.clearTimeout(this.rowCtx.hover.timer);
		this.rowCtx.hoverCardEl.remove();
		return Promise.resolve();
	}

	private render(): void {
		if (!this.bodyEl) return;
		this.bodyEl.empty();
		if (!this.filePath) return;

		const cached = this.deps.manager.getPage(this.filePath);
		if (!cached) {
			this.bodyEl.createDiv({
				cls: "pantry-empty",
				text: "This note isn't recognised as an inventory page yet (check the inventory folders/type settings), or it hasn't loaded yet.",
			});
			return;
		}
		const { file, page } = cached;

		const header = this.bodyEl.createDiv({ cls: "pantry-page-view-header" });
		header.createEl("h2", { text: file.basename, cls: "pantry-title" });

		for (const section of page.sections) {
			renderSectionCard(this.rowCtx, this.bodyEl, file.path, file.basename, section);
		}

		const addSectionRow = this.bodyEl.createDiv({
			cls: "pantry-quick-add pantry-add-section-row",
		});
		wireQuickAddRow(this.rowCtx, addSectionRow, "New section name…", (name) => {
			runWrite(this.deps.manager.addSection(file.path, name, []));
		});

		restoreFocus(this.rowCtx);
	}

	private confirmDeletePage(): void {
		const filePath = this.filePath;
		if (!filePath) return;
		const basename = this.deps.manager.getPage(filePath)?.file.basename ?? "this page";
		new ConfirmModal(this.app, {
			title: "Delete inventory page",
			message: `Move "${basename}" to trash? The note goes to system trash and can be recovered.`,
			confirmText: "Delete page",
			destructive: true,
			onConfirm: async () => {
				await this.deps.manager.deletePage(filePath);
				this.leaf.detach();
			},
		}).open();
	}
}

/** True when the file is a currently-recognised inventory page (right folder + frontmatter type). */
export function isInventoryPageFile(manager: InventoryManager, file: TFile): boolean {
	return manager.getPage(file.path) !== undefined;
}
