import { App, Modal, Notice, Setting } from "obsidian";
import { InventoryItem } from "../types";

/**
 * Modal that adds or edits an inventory item's descriptive fields.
 * Quantity and desired quantity are edited directly on the item card.
 */
export class AddItemModal extends Modal {
	private name: string;
	private unit: string;
	private category: string;
	private expirationDate: string;
	private notes: string;
	private itemUrl: string;
	private readonly existing: InventoryItem | null;

	constructor(
		app: App,
		private readonly onSave: (item: InventoryItem) => Promise<void>,
		existing?: InventoryItem,
	) {
		super(app);
		this.existing = existing ?? null;
		this.name = existing?.name ?? "";
		this.unit = existing?.unit ?? "";
		this.category = existing?.category ?? "";
		this.expirationDate = existing?.expirationDate ?? "";
		this.notes = existing?.notes ?? "";
		this.itemUrl = existing?.itemUrl ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		const editing = this.existing !== null;
		contentEl.createEl("h2", {
			text: editing ? "Edit inventory item" : "Add inventory item",
		});

		new Setting(contentEl).setName("Name").addText((text) =>
			text
				.setPlaceholder("Item name")
				.setValue(this.name)
				.onChange((value) => {
					this.name = value;
				}),
		);

		new Setting(contentEl).setName("Unit").addText((text) =>
			text
				.setPlaceholder("e.g., cups, lbs, oz (optional)")
				.setValue(this.unit)
				.onChange((value) => {
					this.unit = value;
				}),
		);

		new Setting(contentEl)
			.setName("Category")
			.setDesc("Optional. Leave blank for uncategorized.")
			.addText((text) =>
				text
					.setPlaceholder("e.g., Pantry, Freezer, Fridge")
					.setValue(this.category)
					.onChange((value) => {
						this.category = value;
					}),
			);

		new Setting(contentEl)
			.setName("Expiration date")
			.setDesc("Optional.")
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(this.expirationDate)
					.onChange((value) => {
						this.expirationDate = value;
					}),
			);

		new Setting(contentEl)
			.setName("Notes")
			.setDesc("Optional notes about this item.")
			.addTextArea((text) =>
				text
					.setPlaceholder("e.g., location, opened date, etc.")
					.setValue(this.notes)
					.onChange((value) => {
						this.notes = value;
					}),
			);

		new Setting(contentEl)
			.setName("Instacart product URL")
			.setDesc("Optional. Link to the item's product page on Instacart. Your top-priority store (configured from the inventory header) overrides the link's retailer when you click the cart button.")
			.addText((text) =>
				text
					.setPlaceholder("https://www.instacart.com/products/...")
					.setValue(this.itemUrl)
					.onChange((value) => {
						this.itemUrl = value;
					}),
			);

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Cancel")
					.onClick(() => this.close()),
			)
			.addButton((btn) =>
				btn
					.setButtonText(editing ? "Save" : "Add")
					.setCta()
					.onClick(() => {
						void this.submit();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		const name = this.name.trim();

		if (!name) {
			new Notice("Please enter an item name.");
			return;
		}

		const unit = this.unit.trim();
		const category = this.category.trim() || null;
		const expirationDate = this.expirationDate.trim() || null;
		const notes = this.notes.trim() || null;
		const itemUrl = this.itemUrl.trim() || null;

		const item: InventoryItem = {
			id: this.existing?.id ?? generateItemId(),
			name,
			// Quantity fields are edited directly on the item card, not here.
			quantity: this.existing?.quantity ?? 0,
			desiredQuantity: this.existing?.desiredQuantity ?? 0,
			unit,
			category,
			expirationDate,
			notes,
			itemUrl,
			dateAdded: this.existing?.dateAdded ?? new Date().toISOString(),
		};

		try {
			await this.onSave(item);
			this.close();
		} catch (e) {
			new Notice(`Error saving item: ${String(e)}`);
		}
	}
}

function generateItemId(): string {
	return `${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
}
