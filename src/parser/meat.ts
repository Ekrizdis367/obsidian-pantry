/**
 * Meat detection helper used by the recipe view to surface a small
 * food-safety warning next to ingredients that need to hit a safe
 * minimum internal temperature.
 *
 * Temperatures follow the USDA "Safe Minimum Internal Temperature"
 * chart (https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/safe-temperature-chart).
 */

export interface MeatTemp {
	/** Human-readable category, e.g. "Poultry". */
	category: string;
	/** Safe minimum internal temperature in Fahrenheit. */
	fahrenheit: number;
	/** Safe minimum internal temperature in Celsius. */
	celsius: number;
}

interface MeatGroup {
	keywords: string[];
	temp: MeatTemp;
}

const POULTRY: MeatTemp = {
	category: "Poultry",
	fahrenheit: 165,
	celsius: 74,
};
const GROUND: MeatTemp = {
	category: "Ground meat",
	fahrenheit: 160,
	celsius: 71,
};
const PORK: MeatTemp = { category: "Pork", fahrenheit: 145, celsius: 63 };
const RED_MEAT: MeatTemp = {
	category: "Beef / lamb / veal",
	fahrenheit: 145,
	celsius: 63,
};
const FISH: MeatTemp = { category: "Fish", fahrenheit: 145, celsius: 63 };
const SHELLFISH: MeatTemp = {
	category: "Shellfish",
	fahrenheit: 145,
	celsius: 63,
};

const MEAT_GROUPS: MeatGroup[] = [
	{
		keywords: [
			"ground chicken",
			"ground turkey",
			"ground duck",
			"ground poultry",
			"chicken sausage",
			"turkey sausage",
			"rotisserie chicken",
			"chicken thigh",
			"chicken thighs",
			"chicken breast",
			"chicken breasts",
			"chicken wing",
			"chicken wings",
			"chicken drumstick",
			"chicken drumsticks",
			"chicken leg",
			"chicken legs",
			"chicken tender",
			"chicken tenders",
			"chicken",
			"turkey",
			"duck",
			"goose",
			"cornish hen",
			"poultry",
		],
		temp: POULTRY,
	},
	{
		keywords: [
			"ground beef",
			"ground pork",
			"ground lamb",
			"ground veal",
			"ground meat",
			"hamburger meat",
			"hamburger patty",
			"burger patty",
			"minced beef",
			"minced pork",
			"minced lamb",
			"italian sausage",
			"breakfast sausage",
			"pork sausage",
			"chorizo",
			"merguez",
			"bratwurst",
			"brat",
			"sausage",
		],
		temp: GROUND,
	},
	{
		keywords: [
			"pork chop",
			"pork chops",
			"pork loin",
			"pork shoulder",
			"pork tenderloin",
			"pork belly",
			"pork ribs",
			"pork ribs",
			"pork",
			"ham",
			"bacon",
			"prosciutto",
			"pancetta",
			"ribs",
			"baby back ribs",
			"spare ribs",
		],
		temp: PORK,
	},
	{
		keywords: [
			"ribeye",
			"sirloin",
			"tenderloin",
			"filet mignon",
			"t-bone",
			"porterhouse",
			"ny strip",
			"new york strip",
			"flank steak",
			"skirt steak",
			"flat iron steak",
			"hanger steak",
			"brisket",
			"chuck roast",
			"chuck steak",
			"roast beef",
			"beef stew meat",
			"beef short rib",
			"steak",
			"beef",
			"lamb chop",
			"lamb chops",
			"lamb shoulder",
			"lamb leg",
			"leg of lamb",
			"lamb shank",
			"lamb",
			"veal",
		],
		temp: RED_MEAT,
	},
	{
		keywords: [
			"salmon fillet",
			"tuna steak",
			"fish fillet",
			"fish steak",
			"salmon",
			"tuna",
			"tilapia",
			"cod",
			"trout",
			"halibut",
			"mahi-mahi",
			"mahi mahi",
			"mahi",
			"snapper",
			"swordfish",
			"sea bass",
			"branzino",
			"barramundi",
			"haddock",
			"pollock",
			"anchovy",
			"anchovies",
			"sardine",
			"sardines",
			"fish",
		],
		temp: FISH,
	},
	{
		keywords: [
			"shrimp",
			"prawn",
			"prawns",
			"scallop",
			"scallops",
			"crab",
			"lobster",
			"clam",
			"clams",
			"mussel",
			"mussels",
			"oyster",
			"oysters",
			"crawfish",
			"crayfish",
		],
		temp: SHELLFISH,
	},
];

/**
 * Words that, when present, mean the ingredient is a flavoring or
 * pantry staple rather than the meat itself. "Chicken broth", "fish
 * sauce", "beef bouillon", etc. should not get a temperature warning.
 */
const NON_MEAT_QUALIFIERS = [
	"stock",
	"broth",
	"bouillon",
	"consomme",
	"consommé",
	"sauce",
	"powder",
	"extract",
	"flavor",
	"flavoring",
	"flavour",
	"flavouring",
	"seasoning",
	"rub",
	"jerky",
];

interface PreparedKeyword {
	regex: RegExp;
	temp: MeatTemp;
	length: number;
}

const PREPARED_KEYWORDS: PreparedKeyword[] = [];
for (const group of MEAT_GROUPS) {
	for (const keyword of group.keywords) {
		PREPARED_KEYWORDS.push({
			regex: buildKeywordRegex(keyword),
			temp: group.temp,
			length: keyword.length,
		});
	}
}
PREPARED_KEYWORDS.sort((a, b) => b.length - a.length);

const NON_MEAT_REGEX = new RegExp(
	`\\b(?:${NON_MEAT_QUALIFIERS.map(escapeRegex).join("|")})\\b`,
	"i",
);

/**
 * Returns the safe internal temperature for an ingredient name, or null
 * if it doesn't look like a meat that needs a warning. Longer keywords
 * win, so "ground turkey" is treated as poultry rather than just
 * "turkey".
 */
export function detectMeatTemp(name: string): MeatTemp | null {
	const text = name.toLowerCase();
	if (NON_MEAT_REGEX.test(text)) return null;
	for (const entry of PREPARED_KEYWORDS) {
		if (entry.regex.test(text)) return entry.temp;
	}
	return null;
}

function buildKeywordRegex(keyword: string): RegExp {
	const escaped = escapeRegex(keyword);
	const suffix = /s$/i.test(keyword) ? "" : "s?";
	return new RegExp(
		`(?:^|[^a-z0-9])${escaped}${suffix}(?:[^a-z0-9]|$)`,
		"i",
	);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
