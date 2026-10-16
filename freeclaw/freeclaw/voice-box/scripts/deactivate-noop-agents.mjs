/**
 * Deactivate the no-op agents.
 *
 * WHY: `auditRoster()` in api/_agent-behaviours.js measures what each agent can
 * actually change. Retired agents route to no behaviour at all — they cannot
 * perform the ACT step, so they are not operational workers: they only consume
 * cron budget and inflate the roster count on the dashboard.
 *
 * WHAT IT CHANGES: writes `active: false` for exactly those agents into the
 * `agent_activation_state` settings row. Every other agent's entry is preserved
 * untouched. Nothing is deleted and no code is modified, so this is fully
 * reversible by re-running with the id removed from the list, or by toggling the
 * agent back on in the admin console.
 *
 * USAGE:
 *   node --env-file=.env scripts/deactivate-noop-agents.mjs --dry-run
 *   node --env-file=.env scripts/deactivate-noop-agents.mjs
 */
import supabase from "../api/_db-client.js";
import { ALL_AGENTS } from "../api/_agent-team.js";
import { classifyAgent } from "../api/_agent-behaviours.js";

const DRY_RUN = process.argv.includes("--dry-run");
const ACTIVATION_KEY = "agent_activation_state";

const retired = ALL_AGENTS.filter((a) => classifyAgent(a).status === "retired");
if (retired.length === 0) {
	console.log("Nothing to do: no agent routes to a retired behaviour.");
	process.exit(0);
}

const { data } = await supabase
	.from("settings")
	.select("value")
	.eq("key", ACTIVATION_KEY)
	.maybeSingle();
const current = data?.value?.agents || {};

const next = { ...current };
let changed = 0;
for (const a of retired) {
	if (current[a.id]?.active === false) continue; // already off
	next[a.id] = { ...(current[a.id] || {}), active: false, autonomous: false };
	changed++;
}

console.log(
	`retired (no behaviour): ${retired.length} | newly deactivated: ${changed} | already off: ${retired.length - changed}`,
);
for (const a of retired) console.log(`  ${a.id.padEnd(28)} ${a.name}`);

if (DRY_RUN) {
	console.log("\n--dry-run: nothing written.");
	process.exit(0);
}
if (changed === 0) {
	console.log("\nNothing to write.");
	process.exit(0);
}

const { error } = await supabase.from("settings").upsert(
	{
		key: ACTIVATION_KEY,
		value: { agents: next, updated_at: new Date().toISOString() },
	},
	{ onConflict: "key" },
);
if (error) {
	console.error("FAILED:", error.message);
	process.exit(1);
}

// Verify by re-reading rather than trusting the write.
const { data: after } = await supabase
	.from("settings")
	.select("value")
	.eq("key", ACTIVATION_KEY)
	.maybeSingle();
const stored = after?.value?.agents || {};
const off = Object.values(stored).filter((v) => v?.active === false).length;
console.log(
	`\nstored: ${Object.keys(stored).length} entries, ${off} deactivated (expected ${changed} new).`,
);
process.exit(0);
