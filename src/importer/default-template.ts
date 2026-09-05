/**
 * Canonical Pantry recipe note template.
 *
 * Every imported recipe is rendered through this shape so vault notes stay
 * consistent: the same frontmatter keys in the same order, the same section
 * headings, and the same list formats Pantry's parser and recipe view expect.
 *
 * Token syntax: {{name}} — replaced at import time. Property-name tokens
 * (recipeTypeProperty, selectionProperty, lastMadeProperty) are filled from
 * settings so the note matches your configured frontmatter names.
 */
export const DEFAULT_RECIPE_NOTE_TEMPLATE = `---
{{recipeTypeProperty}}: {{recipeTypeValue}}
category: {{category}}
source: {{source}}
image: {{image}}
{{selectionProperty}}: false
multiplier: 1
servings: {{servings}}
calories: {{calories}}
protein: {{protein}}
fat: {{fat}}
carbs: {{carbs}}
fiber: {{fiber}}
diet: []
allergens: []
prepTime: {{prepTime}}
cookTime: {{cookTime}}
totalTime: {{totalTime}}
favorite: false
{{lastMadeProperty}}:
cookedCount: 0
---

{{description}}

## {{ingredientsHeading}}

{{ingredients}}

## {{instructionsHeading}}

{{instructions}}
`;

/** Tokens documented for user-editable vault templates. */
export const RECIPE_TEMPLATE_TOKEN_HINT = [
	"recipeTypeProperty",
	"recipeTypeValue",
	"category",
	"source",
	"image",
	"selectionProperty",
	"servings",
	"calories",
	"protein",
	"fat",
	"carbs",
	"fiber",
	"prepTime",
	"cookTime",
	"totalTime",
	"lastMadeProperty",
	"description",
	"ingredientsHeading",
	"instructionsHeading",
	"ingredients",
	"instructions",
	"title",
	"date",
].join(", ");
