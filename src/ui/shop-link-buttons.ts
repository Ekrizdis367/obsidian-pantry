import { setIcon } from "obsidian";
import { ShopLink } from "../types";

/** Render a row of shop-link buttons (icon + nickname), opening each URL as-is. */
export function renderShopLinkButtons(
	container: HTMLElement,
	shopLinks: ShopLink[],
): void {
	for (const link of shopLinks) {
		const btn = container.createEl("button", {
			cls: "clickable-icon pantry-shop-link-btn",
			attr: { title: link.url },
		});
		setIcon(btn.createSpan({ cls: "pantry-shop-link-icon" }), "shopping-cart");
		btn.createSpan({
			cls: "pantry-shop-link-label",
			text: link.nickname || "Shop",
		});
		btn.addEventListener("click", () => {
			window.open(link.url, "_blank");
		});
	}
}
