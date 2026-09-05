import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import { InventoryItem, ShopLink } from "../types";

/** Maximum number of shop links per inventory item. */
const MAX_SHOP_LINKS = 4;

/**
 * Modal that adds or edits an inventory item's descriptive fields.
 * Stock status (In) is toggled directly on the item card.
 */
export class AddItemModal extends Modal {
	private name: string;
	private unit: string;
	private category: string;
	private expirationDate: string;
	private notes: string;
	private tagsText: string;
	private shopLinks: ShopLink[];
	private shopLinksEl!: HTMLElement;
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
		this.tagsText = (existing?.tags ?? []).join(", ");
		this.shopLinks = (existing?.shopLinks ?? []).map((l) => ({ ...l }));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		const editing = this.existing !== null;
		contentEl.createEl("h2", {
			text: editing ? "Edit Inventory Item" : "Add Inventory Item",
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
				.setPlaceholder("E.g., cups, lbs, oz (optional)")
				.setValue(this.unit)
				.onChange((value) => {
					this.unit = value;
				}),
		);

		new Setting(contentEl)
			.setName("Category")
			.setDesc("Optional category for organizing your inventory.")
			.addText((text) =>
				text
					.setPlaceholder("Pantry, freezer, or fridge")
					.setValue(this.category)
					.onChange((value) => {
						this.category = value;
					}),
			);

		new Setting(contentEl)
			.setName("Tags")
			.setDesc("Labels for filtering and organizing items.")
			.addText((text) =>
				text
					.setPlaceholder("E.g., baking, breakfast")
					.setValue(this.tagsText)
					.onChange((value) => {
						this.tagsText = value;
					}),
			);

		new Setting(contentEl)
			.setName("Expiration date")
			.setDesc("Date the item expires (optional).")
			.addText((text) =>
				text
					.setPlaceholder("2024-12-31")
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
					.setPlaceholder("E.g., location, opened date, etc.")
					.setValue(this.notes)
					.onChange((value) => {
						this.notes = value;
					}),
			);

		new Setting(contentEl)
			.setName("Shop links")
			.setDesc(`Up to ${MAX_SHOP_LINKS} direct links to this item at stores you shop at. Each opens exactly as entered.`)
			.setHeading();

		this.shopLinksEl = contentEl.createDiv({ cls: "pantry-shop-link-editor" });
		this.renderShopLinks();

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

	private renderShopLinks(): void {
		this.shopLinksEl.empty();

		this.shopLinks.forEach((link, index) => {
			const row = this.shopLinksEl.createDiv({ cls: "pantry-shop-link-row" });

			const nicknameInput = row.createEl("input", {
				cls: "pantry-shop-link-nickname",
				type: "text",
				attr: { placeholder: "Store name" },
			});
			nicknameInput.value = link.nickname;
			nicknameInput.addEventListener("input", () => {
				link.nickname = nicknameInput.value;
			});

			const urlInput = row.createEl("input", {
				cls: "pantry-shop-link-url",
				type: "text",
				attr: { placeholder: "Product page URL" },
			});
			urlInput.value = link.url;
			urlInput.addEventListener("input", () => {
				link.url = urlInput.value;
			});

			const removeBtn = row.createEl("button", {
				cls: "clickable-icon pantry-remove",
				attr: { title: "Remove shop link" },
			});
			setIcon(removeBtn, "trash-2");
			removeBtn.addEventListener("click", () => {
				this.shopLinks.splice(index, 1);
				this.renderShopLinks();
			});
		});

		if (this.shopLinks.length < MAX_SHOP_LINKS) {
			const addBtn = this.shopLinksEl.createEl("button", {
				text: "Add shop link",
			});
			addBtn.addEventListener("click", () => {
				this.shopLinks.push({ nickname: "", url: "" });
				this.renderShopLinks();
			});
		}
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
		const tags = this.tagsText
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		const shopLinks = this.shopLinks
			.map((l) => ({ nickname: l.nickname.trim(), url: l.url.trim() }))
			.filter((l) => l.url !== "");

		const item: InventoryItem = {
			id: this.existing?.id ?? generateItemId(),
			name,
			// New staples default to in-stock.
			inStock: this.existing?.inStock ?? true,
			unit,
			category,
			expirationDate,
			notes,
			tags,
			shopLinks,
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
