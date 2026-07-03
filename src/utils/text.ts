/**
 * Capitalise the first letter of every space- or hyphen-separated word so
 * stored, lower-cased ingredient names render as "Ground Beef" or
 * "All-Purpose Flour" without losing apostrophe-ed words like "shepherd's".
 */
export function toTitleCase(name: string): string {
	return name.replace(
		/(^|[\s-])([a-z])/g,
		(_match, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`,
	);
}

/** Captured regex group as a string (empty when the group is missing). */
export function regexCapture(match: RegExpMatchArray, index: number): string {
	const value = match[index];
	return typeof value === "string" ? value : "";
}

/** Remove trailing whitespace without relying on ES2019 `trimEnd` typings. */
export function trimEndText(text: string): string {
	return text.replace(/\s+$/u, "");
}

/** Remove leading whitespace without relying on ES2019 `trimStart` typings. */
export function trimStartText(text: string): string {
	return text.replace(/^\s+/u, "");
}

/** Trim both ends without relying on lib gaps for string prototype methods. */
export function trimText(text: string): string {
	return text.replace(/^\s+|\s+$/u, "");
}

/**
 * Invoke `fn` for each first capture group matched by `pattern` in `text`.
 * Uses `exec` instead of ES2020 `matchAll` for consistent type-checked lint.
 */
export function forEachRegexCapture(
	text: string,
	pattern: RegExp,
	fn: (capture: string) => void,
): void {
	const flags = pattern.flags.includes("g")
		? pattern.flags
		: `${pattern.flags}g`;
	const re = new RegExp(pattern.source, flags);
	let match = re.exec(text);
	while (match !== null) {
		fn(regexCapture(match, 1));
		match = re.exec(text);
	}
}

/**
 * Normalise a frontmatter value that may be an Obsidian wikilink.
 *
 * Obsidian's property picker stores a linked value like `[[Recipes]]` as the
 * literal string `"[[Recipes]]"`. We unwrap the brackets and reduce it to the
 * note name so it can be compared against a plain configured value: the display
 * alias (`[[Page|Alias]]`), folder path (`[[folder/Page]]`), and heading anchor
 * (`[[Page#Heading]]`) are all dropped, leaving just `Page`. Plain strings pass
 * through unchanged (trimmed).
 */
export function stripWikiLink(value: string): string {
	const trimmed = value.trim();
	const match = trimmed.match(/^\[\[(.+?)\]\]$/);
	if (!match) return trimmed;

	let inner = match[1] ?? "";
	const pipe = inner.indexOf("|");
	if (pipe >= 0) inner = inner.slice(0, pipe);
	const hash = inner.indexOf("#");
	if (hash >= 0) inner = inner.slice(0, hash);
	const slash = inner.lastIndexOf("/");
	if (slash >= 0) inner = inner.slice(slash + 1);
	return inner.trim();
}
