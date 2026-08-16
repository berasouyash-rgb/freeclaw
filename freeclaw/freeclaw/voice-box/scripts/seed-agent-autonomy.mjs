// One-off maintenance script: mark every roster agent as active + autonomous
// so the daily cron executes the full team. Safe to re-run (upsert).
// Usage: node scripts/seed-agent-autonomy.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env loader (no dotenv dependency needed)
function loadEnv() {
	const envPath = join(root, ".env");
	if (!existsSync(envPath)) return;
	for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (!(key in process.env)) process.env[key] = value;
	}
}
loadEnv();

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
	console.error(
		"Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env",
	);
	process.exit(1);
}

const { ALL_AGENTS } = await import(
	pathToFileURL(join(root, "api", "_agent-team.js")).href
);

const supabase = createClient(url, key);
const state = { agents: {}, updated_at: new Date().toISOString() };
for (const a of ALL_AGENTS) {
	state.agents[a.id] = { active: true, autonomous: true };
}

const { error } = await supabase
	.from("settings")
	.upsert(
		{ key: "agent_activation_state", value: state },
		{ onConflict: "key" },
	);

if (error) {
	console.error("Seed failed:", error.message);
	process.exit(1);
}
console.log(
	`Seeded agent_activation_state: ${ALL_AGENTS.length} agents marked active+autonomous`,
);
