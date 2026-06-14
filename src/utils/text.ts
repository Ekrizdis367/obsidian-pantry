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
