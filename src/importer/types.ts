/** Structured recipe data extracted from a web page. */
export interface ImportedRecipe {
	title: string;
	description: string;
	/** Hero image URL or vault-relative path. */
	image: string;
	/** Raw yields string from schema.org (e.g. "4 servings"). */
	servings: string;
	prepTime: number | null;
	cookTime: number | null;
	totalTime: number | null;
	ingredientLines: string[];
	instructionSteps: string[];
	sourceUrl: string;
	calories: number | null;
	protein: number | null;
	fat: number | null;
	carbs: number | null;
	fiber: number | null;
}
