import { requestUrl } from "obsidian";

const BROWSER_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
	"AppleWebKit/537.36 (KHTML, like Gecko) " +
	"Chrome/124.0.0.0 Safari/537.36";

/**
 * Fetch a URL's raw HTML via Obsidian's requestUrl (bypasses CSP).
 * Sends a browser-like User-Agent so recipe sites don't block the request.
 * Returns null if the request fails or the response is not HTML.
 */
export async function fetchHtml(url: string): Promise<string | null> {
	try {
		const response = await requestUrl({
			url,
			method: "GET",
			headers: {
				"User-Agent": BROWSER_UA,
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.9",
			},
		});
		const contentType = response.headers["content-type"] ?? "";
		if (!contentType.includes("html") && !contentType.includes("text")) {
			return null;
		}
		return response.text;
	} catch {
		return null;
	}
}
