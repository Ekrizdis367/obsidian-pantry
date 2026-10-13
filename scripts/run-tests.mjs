import { readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import esbuild from "esbuild";

const TEST_DIR = "tests";
const OUT_DIR = ".test-build";

const entryPoints = readdirSync(TEST_DIR)
	.filter((f) => f.endsWith(".test.ts"))
	.map((f) => path.join(TEST_DIR, f));

rmSync(OUT_DIR, { recursive: true, force: true });
await esbuild.build({
	entryPoints,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node18",
	outdir: OUT_DIR,
	outExtension: { ".js": ".mjs" },
	// The real "obsidian" package is types-only; tests get a tiny runtime stub.
	alias: { obsidian: `./${TEST_DIR}/obsidian-stub.ts` },
	logLevel: "warning",
});

const files = readdirSync(OUT_DIR)
	.filter((f) => f.endsWith(".mjs"))
	.map((f) => path.join(OUT_DIR, f));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
