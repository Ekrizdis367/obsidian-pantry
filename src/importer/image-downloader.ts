import { App, requestUrl } from "obsidian";
import { ensureParentFolders, titleToFilename } from "./note-builder";

/** Cap on downloaded image size; keeps multi-MB binaries out of the vault. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

/** Common image MIME types mapped to file extensions (subtype alone breaks `svg+xml`). */
const MIME_EXTENSIONS: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/avif": "avif",
	"image/bmp": "bmp",
	"image/tiff": "tiff",
	"image/x-icon": "ico",
};

/**
 * Download a remote image into the vault and return its vault-relative path.
 *
 * Returns null when the URL is empty/unresolvable, the request fails or times
 * out, the response isn't an image, it's too large, or the vault write fails —
 * callers keep the original remote URL then.
 * The filename carries a short hash of the image URL so recipes sharing a
 * title don't reuse each other's photo, while re-importing the same recipe
 * reuses its file instead of duplicating it.
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

	// Drop `.`, `..`, and empty segments so a save folder can't escape the vault.
	const folder = targetFolder
		.trim()
		.split("/")
		.filter((part) => part && part !== "." && part !== "..")
		.join("/");

	const response = await withTimeout(
		requestUrl({ url: absoluteUrl, method: "GET" }),
		DOWNLOAD_TIMEOUT_MS,
	).catch(() => null);
	if (!response) return null;

	// Normalize the content-type.
	// Example input/output: `IMAGE/PNG ; charset=utf-8` -> `image/png` (media types are case-insensitive).
	const rawContentType = response.headers?.["content-type"] ?? "";
	const contentType = (rawContentType.split(";")[0] ?? "")
		.trim()
		.toLowerCase();
	if (!contentType.startsWith("image/")) return null;

	// requestUrl buffers the whole body, so this guards vault writes, not memory.
	const declaredSize = Number(response.headers?.["content-length"]);
	if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
		return null;
	}
	if (response.arrayBuffer.byteLength > MAX_IMAGE_BYTES) return null;

	const ext =
		MIME_EXTENSIONS[contentType] ??
		(contentType.slice("image/".length).replace(/[^a-z0-9]/g, "") || "png");
	const name = `${titleToFilename(recipeTitle)}-${shortHash(absoluteUrl)}.${ext}`;
	const filePath = folder ? `${folder}/${name}` : name;

	// Vault write failures (permissions, bad path) must not abort the import.
	try {
		if (await app.vault.adapter.exists(filePath)) return filePath;
		await ensureParentFolders(app, filePath);
		await app.vault.createBinary(filePath, response.arrayBuffer);
	} catch {
		return null;
	}
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

/**
 * Deterministic short hash so the same image URL always maps to the same file.
 * Base36, at most 6 chars (36^6 > Number's int32 range).
 */
function shortHash(value: string): string {
	let hash = 0;
	for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
	return Math.abs(hash).toString(36);
}

/**
 * Race the request against a timeout. `requestUrl` is the only CORS-bypassing
 * download API and it has no timeout or abort hook, so racing its promise is
 * the minimal portable fix (`node:timers/promises` would break mobile).
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: number | undefined;
	return Promise.race([
		promise.finally(() => window.clearTimeout(timer)),
		new Promise<never>((_, reject) => {
			timer = window.setTimeout(
				() => reject(new Error("Image download timed out")),
				ms,
			);
		}),
	]);
}
