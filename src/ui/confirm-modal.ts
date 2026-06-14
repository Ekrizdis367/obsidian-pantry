import { App, Modal } from "obsidian";

export interface ConfirmModalOptions {
	title: string;
	message: string;
	confirmText?: string;
	destructive?: boolean;
	onConfirm: () => void | Promise<void>;
}

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly options: ConfirmModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.options.title);
		contentEl.createEl("p", { text: this.options.message });

		const actions = contentEl.createDiv({ cls: "pantry-modal-actions" });
		actions
			.createEl("button", { text: "Cancel", attr: { type: "button" } })
			.addEventListener("click", () => this.close());

		const confirm = actions.createEl("button", {
			text: this.options.confirmText ?? "Confirm",
			cls: this.options.destructive ? "mod-warning" : "mod-cta",
			attr: { type: "button" },
		});
		confirm.addEventListener("click", () => {
			confirm.disabled = true;
			void Promise.resolve(this.options.onConfirm()).finally(() =>
				this.close(),
			);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
