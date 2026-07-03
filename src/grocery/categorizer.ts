import { CategoryOverride, CategorySource } from "../types";

/**
 * Built-in keyword -> category mapping.
 *
 * Matching is substring based so "roma tomatoes" still hits "tomato".
 * Longer keywords are checked first so "ground beef" wins over "beef".
 *
 * Category names align with the user's recipe tag scheme so dictionary
 * fallback and tag-derived categories consolidate into a single section
 * (e.g. dictionary picks "Dairy", not "Dairy & Eggs", so it never
 * duplicates a recipe's `#Dairy` tag).
 */
const BUILTIN_CATEGORIES: Record<string, string[]> = {
	Produce: [
		"lettuce", "spinach", "kale", "arugula", "romaine", "cabbage", "broccoli",
		"cauliflower", "carrot", "celery", "cucumber", "tomato", "potato", "sweet potato",
		"onion", "scallion", "shallot", "leek", "garlic", "ginger", "bell pepper",
		"jalapeno", "chili", "chile", "mushroom", "zucchini", "squash", "pumpkin",
		"eggplant", "asparagus", "green bean", "pea", "corn", "avocado", "lemon", "lime",
		"orange", "apple", "banana", "berry", "berries", "strawberry", "blueberry",
		"raspberry", "blackberry", "grape", "melon", "watermelon", "pear", "peach",
		"plum", "cherry", "pineapple", "mango", "kiwi", "salad",
		"radish", "beet", "turnip", "fennel", "bok choy", "okra",
	],
	Herb: [
		"cilantro", "parsley", "basil", "mint", "rosemary", "thyme", "sage", "dill",
		"chive", "oregano", "fresh herb",
	],
	Bread: [
		"bread", "loaf", "baguette", "bagel", "tortilla", "pita", "naan", "bun", "roll",
		"croissant", "muffin", "english muffin", "pie crust", "puff pastry",
	],
	Meat: [
		"chicken", "turkey", "duck", "beef", "steak", "ground beef", "ground turkey",
		"ground chicken", "pork", "bacon", "ham", "sausage", "lamb", "veal", "ribs",
		"brisket",
	],
	Seafood: [
		"fish", "salmon", "tuna", "tilapia", "cod", "trout", "halibut",
		"shrimp", "prawn", "scallop", "crab", "lobster", "clam", "mussel", "oyster",
		"anchovy", "sardine",
	],
	Dairy: [
		"milk", "cream", "half and half", "half-and-half", "butter", "yogurt", "yoghurt",
		"sour cream", "creme fraiche", "ghee",
	],
	Cheese: [
		"cheese", "cheddar", "mozzarella", "parmesan", "feta", "ricotta", "cottage cheese",
	],
	Egg: ["egg", "eggs"],
	Pasta: [
		"pasta", "noodle", "spaghetti", "penne", "fusilli", "lasagna", "couscous",
	],
	Grain: [
		"rice", "quinoa", "oat", "oatmeal", "granola", "cereal",
	],
	Canned: [
		"canned", "tomato sauce", "tomato paste", "diced tomato", "crushed tomato",
		"lentil", "bean", "chickpea", "garbanzo", "black bean", "kidney bean",
	],
	Broth: ["broth", "stock", "bouillon", "stock cube"],
	Sauce: [
		"salsa", "soy sauce", "fish sauce", "hot sauce", "sriracha",
	],
	Condiment: [
		"ketchup", "mustard", "mayonnaise", "mayo", "jam", "jelly", "preserve",
		"peanut butter", "almond butter",
	],
	Oil: [
		"oil", "olive oil", "vegetable oil", "canola oil", "coconut oil", "sesame oil",
		"vinegar",
	],
	Seasoning: [
		"salt", "pepper", "spice", "cinnamon", "cumin", "paprika", "turmeric", "curry",
		"chili powder", "red pepper flake", "bay leaf", "nutmeg", "cardamom",
	],
	Baking: [
		"flour", "all-purpose flour", "bread flour", "sugar", "brown sugar",
		"powdered sugar", "baking powder", "baking soda", "yeast", "vanilla", "cocoa",
		"chocolate", "honey", "maple syrup", "syrup", "cake",
	],
	Pantry: [
		"almond", "walnut", "pecan", "cashew", "pistachio", "peanut", "sunflower seed",
		"pumpkin seed", "raisin", "cranberry", "soup",
	],
	Snack: ["cracker", "chip", "popcorn"],
	Frozen: [
		"frozen", "ice cream", "gelato", "sorbet", "popsicle", "frozen vegetable",
		"frozen fruit", "frozen pizza",
	],
	Beverage: [
		"water", "sparkling water", "soda", "cola", "coffee", "tea", "juice",
		"orange juice", "apple juice", "lemonade", "kombucha",
	],
	Alcohol: ["wine", "beer", "champagne", "sake"],
	Household: [
		"paper towel", "toilet paper", "tissue", "napkin", "trash bag", "soap",
		"dish soap", "detergent", "sponge", "foil", "plastic wrap", "ziploc",
		"parchment", "battery", "lightbulb",
	],
};

interface CompiledEntry {
	keyword: string;
	category: string;
}

const COMPILED_BUILTINS: CompiledEntry[] = (() => {
	const entries: CompiledEntry[] = [];
	for (const category of Object.keys(BUILTIN_CATEGORIES)) {
		const keywords = BUILTIN_CATEGORIES[category];
		if (!keywords) continue;
		for (const keyword of keywords) {
			entries.push({ keyword: keyword.toLowerCase(), category });
		}
	}
	// Longest keyword first so "ground beef" beats "beef".
	entries.sort((a, b) => b.keyword.length - a.keyword.length);
	return entries;
})();

const FALLBACK_CATEGORY = "Other";

/**
 * Determine the category for an ingredient.
 *
 * The decision flows through three layers, depending on `source`:
 *   1. explicit category overrides (always consulted first)
 *   2. recipe-supplied tags (consulted when source is "tag" or "tag-then-dictionary")
 *   3. built-in keyword dictionary (consulted when source is "dictionary" or
 *      "tag-then-dictionary" with no usable tag)
 *
 * Falls back to "Other" when nothing matches.
 */
export function categorize(
	name: string,
	tags: string[] | undefined,
	overrides: CategoryOverride[],
	source: CategorySource,
): string {
	const lower = name.toLowerCase();

	if (overrides.length > 0) {
		const sortedOverrides = [...overrides].sort(
			(a, b) => b.match.length - a.match.length,
		);
		for (const override of sortedOverrides) {
			const needle = override.match.trim().toLowerCase();
			if (!needle) continue;
			if (lower.includes(needle)) return override.category;
		}
	}

	if (source === "tag" || source === "tag-then-dictionary") {
		const tagCategory = pickTagCategory(tags);
		if (tagCategory) return tagCategory;
		if (source === "tag") return FALLBACK_CATEGORY;
	}

	for (const entry of COMPILED_BUILTINS) {
		if (lower.includes(entry.keyword)) return entry.category;
	}

	return FALLBACK_CATEGORY;
}

/**
 * Pick the category to use from a list of recipe tags.
 *
 * Prefers the most-frequent tag (so two recipes agreeing wins over one
 * outlier), with ties broken by first-seen order. Empty/whitespace-only
 * tags are ignored. Output is title-cased for display ("meat" -> "Meat").
 */
function pickTagCategory(tags: string[] | undefined): string | null {
	if (!tags || tags.length === 0) return null;
	const counts = new Map<string, { count: number; firstIndex: number; original: string }>();
	for (let i = 0; i < tags.length; i++) {
		const raw = tags[i] ?? "";
		const key = raw.trim().toLowerCase();
		if (!key) continue;
		const existing = counts.get(key);
		if (existing) {
			existing.count++;
		} else {
			counts.set(key, { count: 1, firstIndex: i, original: raw.trim() });
		}
	}
	if (counts.size === 0) return null;

	let bestKey: string | null = null;
	let bestCount = -1;
	let bestIndex = Number.POSITIVE_INFINITY;
	for (const [key, info] of counts.entries()) {
		if (
			info.count > bestCount ||
			(info.count === bestCount && info.firstIndex < bestIndex)
		) {
			bestKey = key;
			bestCount = info.count;
			bestIndex = info.firstIndex;
		}
	}
	if (!bestKey) return null;
	const original = counts.get(bestKey)?.original ?? bestKey;
	return original.charAt(0).toUpperCase() + original.slice(1);
}
