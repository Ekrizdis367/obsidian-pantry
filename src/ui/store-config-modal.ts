import { App, Modal, Setting, setIcon } from "obsidian";
import { ShoppingStore } from "../settings";

/**
 * Modal for managing the user's local store list, ordered by shopping
 * priority. Index 0 in the array is tried first when adding items to cart.
 */
export class StoreConfigModal extends Modal {
	private stores: ShoppingStore[];
	private newName = "";
	private newId = "";
	private listEl!: HTMLElement;

	constructor(
		app: App,
		stores: ShoppingStore[],
		private readonly onSave: (stores: ShoppingStore[]) => Promise<void>,
	) {
		super(app);
		this.stores = stores.map((s) => ({ ...s }));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Configure stores" });
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "Add the stores you shop at and drag priority order with the up/down buttons. The top store is tried first when adding an item to cart.",
		});

		this.listEl = contentEl.createDiv({ cls: "pantry-store-list" });
		this.renderList();

		new Setting(contentEl).setName("Add a store").setHeading();

		new Setting(contentEl)
			.setName("Store name")
			.addText((text) =>
				text
					.setPlaceholder("e.g., Safeway")
					.onChange((value) => {
						this.newName = value;
					}),
			);

		new Setting(contentEl)
			.setName("Store ID")
			.setDesc("The retailer identifier Instacart uses for this store.")
			.addText((text) =>
				text
					.setPlaceholder("e.g., safeway")
					.onChange((value) => {
						this.newId = value;
					}),
			);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Add store")
				.setCta()
				.onClick(() => {
					this.addStore();
				}),
		);

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Done").onClick(() => this.close()),
		);
	}

	private renderList(): void {
		this.listEl.empty();

		if (this.stores.length === 0) {
			this.listEl.createDiv({
				cls: "pantry-empty",
				text: "No stores configured yet.",
			});
			return;
		}

		this.stores.forEach((store, index) => {
			const row = this.listEl.createDiv({ cls: "pantry-store-row" });

			row.createSpan({
				cls: "pantry-store-priority",
				text: `${index + 1}.`,
			});
			row.createSpan({ cls: "pantry-store-name", text: store.name });
			row.createSpan({ cls: "pantry-store-id", text: store.id });

			const upBtn = row.createEl("button", {
				cls: "clickable-icon",
				attr: { title: "Move up" },
			});
			setIcon(upBtn, "arrow-up");
			upBtn.disabled = index === 0;
			upBtn.addEventListener("click", () => this.moveStore(index, -1));

			const downBtn = row.createEl("button", {
				cls: "clickable-icon",
				attr: { title: "Move down" },
			});
			setIcon(downBtn, "arrow-down");
			downBtn.disabled = index === this.stores.length - 1;
			downBtn.addEventListener("click", () => this.moveStore(index, 1));

			const removeBtn = row.createEl("button", {
				cls: "clickable-icon pantry-remove",
				attr: { title: "Remove store" },
			});
			setIcon(removeBtn, "trash-2");
			removeBtn.addEventListener("click", () => this.removeStore(index));
		});
	}

	private addStore(): void {
		const name = this.newName.trim();
		const id = this.newId.trim();
		if (!name || !id) return;
		this.stores.push({ name, id });
		this.newName = "";
		this.newId = "";
		void this.persist();
		this.onOpen();
	}

	private moveStore(index: number, delta: number): void {
		const target = index + delta;
		if (target < 0 || target >= this.stores.length) return;
		const moved = this.stores.splice(index, 1)[0];
		if (!moved) return;
		this.stores.splice(target, 0, moved);
		void this.persist();
		this.renderList();
	}

	private removeStore(index: number): void {
		this.stores.splice(index, 1);
		void this.persist();
		this.renderList();
	}

	private async persist(): Promise<void> {
		await this.onSave(this.stores.map((s) => ({ ...s })));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
