import { App, requestUrl } from "obsidian";
import { ensureParentFolders, titleToFilename } from "./note-builder";

/**
 * Download a remote image into the vault and return its vault-relative path.
 *
 * Returns null when the request fails, the folder setting is empty, or the
 * response isn't an image — callers keep the original remote URL then.
 * Reuses an existing file at the target path instead of overwriting, so
 * re-importing a recipe (or sharing a hero image across recipes) never
 * duplicates or clobbers images.
 */
export async function downloadImportedImage(
	app: App,
	imageUrl: string,
	pageUrl: string,
	targetFolder: string,
	recipeTitle: string,
): Promise<string | null> {
	const absoluteUrl = resolveImageUrl(imageUrl, pageUrl);
	if (!absoluteUrl) return null;

	const folder = targetFolder.trim().replace(/\/+$/, "");
	if (!folder) return null;

	const response = await requestUrl({ url: absoluteUrl, method: "GET" }).catch(
		() => null,
	);
	if (!response) return null;

	const contentType = (response.headers?.["content-type"] ?? "")
		.split(";")[0] ?? "";
	// Any image/* content type is accepted; the subtype becomes the extension.
	if (!contentType.startsWith("image/")) return null;
	const ext = contentType.slice("image/".length).replace(/[^a-z0-9]/g, "") || "png";

	const filePath = `${folder}/${titleToFilename(recipeTitle)}.${ext}`;
	if (await app.vault.adapter.exists(filePath)) return filePath;

	await ensureParentFolders(app, filePath);
	await app.vault.createBinary(filePath, response.arrayBuffer);
	return filePath;
}

/** Get an absolute url, in case image URL is relative. */
function resolveImageUrl(imageUrl: string, pageUrl: string): string | null {
	const trimmed = imageUrl.trim();
	if (!trimmed) return null;
	try {
		// if imageUrl is relative or absolute, this will return absolute url for you.
		return new URL(trimmed, pageUrl).href;
	} catch {
		return null;
	}
}
