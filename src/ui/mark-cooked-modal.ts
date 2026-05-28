import { App, ButtonComponent, Modal } from "obsidian";

/**
 * Modal that lets the user pick a date before marking a recipe as cooked.
 * The date input is pre-filled with today's local date (YYYY-MM-DD).
 * On confirm the `onConfirm` callback is called with the chosen date string.
 */
export class MarkCookedModal extends Modal {
	constructor(
		app: App,
		private readonly onConfirm: (date: string) => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText("Mark as cooked");
		contentEl.empty();

		contentEl.createEl("p", {
			text: "Choose the date this recipe was cooked.",
		});

		const inputRow = contentEl.createDiv({
			cls: "pantry-mark-cooked-date-row",
		});
		inputRow.createEl("label", {
			text: "Date",
			attr: { for: "pantry-cooked-date" },
		});
		const input = inputRow.createEl("input", {
			type: "date",
			attr: { id: "pantry-cooked-date" },
		});
		input.value = todayLocalISO();

		const buttonRow = contentEl.createDiv({
			cls: "modal-button-container",
		});

		new ButtonComponent(buttonRow)
			.setButtonText("Cancel")
			.onClick(() => this.close());

		new ButtonComponent(buttonRow)
			.setButtonText("Mark as cooked")
			.setCta()
			.onClick(() => {
				const date = input.value.trim() || todayLocalISO();
				this.close();
				void Promise.resolve(this.onConfirm(date));
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function todayLocalISO(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}
