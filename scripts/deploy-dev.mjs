import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

/** Separate plugin id so this coexists with the real "pantry" install in the same vault. */
const DEV_PLUGIN_ID = "pantry-dev";

/** Gitignored, per-contributor file holding the test vault path (one line). */
const LOCAL_VAULT_FILE = ".dev-vault";

let warnedUnconfigured = false;

/** Test vault from `PANTRY_DEV_VAULT`, else `.dev-vault`; null when neither is set. */
function resolveTestVault() {
	let raw = process.env.PANTRY_DEV_VAULT?.trim();
	if (!raw && existsSync(LOCAL_VAULT_FILE)) {
		raw = readFileSync(LOCAL_VAULT_FILE, "utf8").split(/\r?\n/)[0]?.trim();
	}
	if (!raw) return null;
	return path.resolve(raw.replace(/^~(?=$|[/\\])/, homedir()));
}

/** Copy build output into the dev test vault, patching id/version so it's clearly the dev build. */
export function deployToTestVault() {
	const vault = resolveTestVault();
	if (!vault) {
		if (!warnedUnconfigured) {
			console.log(
				`[deploy] skipped: set PANTRY_DEV_VAULT or create ${LOCAL_VAULT_FILE} with your test vault path to auto-deploy.`,
			);
			warnedUnconfigured = true;
		}
		return;
	}
	if (!existsSync(path.join(vault, ".obsidian"))) {
		console.warn(`[deploy] skipped: ${vault} is not an Obsidian vault (no .obsidian folder).`);
		return;
	}

	const deployDir = path.join(vault, ".obsidian", "plugins", DEV_PLUGIN_ID);
	mkdirSync(deployDir, { recursive: true });

	const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
	manifest.id = DEV_PLUGIN_ID;
	manifest.version = `${manifest.version}-dev`;
	writeFileSync(
		path.join(deployDir, "manifest.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);

	copyFileSync("main.js", path.join(deployDir, "main.js"));
	if (existsSync("styles.css")) {
		copyFileSync("styles.css", path.join(deployDir, "styles.css"));
	}

	console.log(`[deploy] synced to ${deployDir} (id: ${manifest.id}, version: ${manifest.version})`);
}

// Allow `node scripts/deploy-dev.mjs` to run this standalone (used by the "deploy" npm script).
if (import.meta.url === `file://${process.argv[1]}`) {
	deployToTestVault();
}
