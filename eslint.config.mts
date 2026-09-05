import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores, defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.mts",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"package.json",
		"package-lock.json",
		"tsconfig.json",
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ["manifest.json"],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...obsidianmd.configs.recommended,
	// Recommended attaches validate-manifest to JS/TS globs only; lint the
	// real manifest.json explicitly so portal/dashboard checks run locally.
	{
		files: ["manifest.json"],
		plugins: {
			obsidianmd,
		},
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				projectService: false,
				extraFileExtensions: [".json"],
			},
		},
		rules: {
			"obsidianmd/validate-manifest": "error",
		},
	},
);
