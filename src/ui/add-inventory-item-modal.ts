import { App, Modal, Notice, Setting } from "obsidian";
import { InventoryItem } from "../types";

/**
 * Modal that adds or edits an inventory item.
 */
export class AddItemModal extends Modal {
	private name: string;
	private quantityText: string;
	private unit: string;
	private category: string;
	private expirationDate: string;
	private notes: string;
	private readonly existing: InventoryItem | null;

	constructor(
		app: App,
		private readonly onSave: (item: InventoryItem) => Promise<void>,
		existing?: InventoryItem,
	) {
		super(app);
		this.existing = existing ?? null;
		this.name = existing?.name ?? "";
		this.quantityText =
			existing?.quantity !== null && existing?.quantity !== undefined
				? String(existing.quantity)
				: "";
		this.unit = existing?.unit ?? "";
		this.category = existing?.category ?? "";
		this.expirationDate = existing?.expirationDate ?? "";
		this.notes = existing?.notes ?? "";
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

		new Setting(contentEl).setName("Quantity").addText((text) =>
			text
				.setPlaceholder("Number (optional)")
				.setValue(this.quantityText)
				.onChange((value) => {
					this.quantityText = value;
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

		const quantity = parseQuantityField(this.quantityText);
		const unit = this.unit.trim();
		const category = this.category.trim() || null;
		const expirationDate = this.expirationDate.trim() || null;
		const notes = this.notes.trim() || null;

		const item: InventoryItem = {
			id: this.existing?.id ?? generateItemId(),
			name,
			quantity,
			unit,
			category,
			expirationDate,
			notes,
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

function parseQuantityField(text: string): number | null {
	if (!text) return null;
	const parsed = parseFloat(text);
	return !isNaN(parsed) ? parsed : null;
}

function generateItemId(): string {
	return `${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
}
