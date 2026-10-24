// Real-import pin: no probed-dead model id may survive as a provider default.
//
// Why this exists: api/_providers.js drives the real LLM chain (deck-narrate,
// reactions, summaries). A dead defaultModel makes every chain call walk a
// 410/404 provider before failing — the exact root cause proven for the dead
// deck AI. providers.test.ts uses a LOCAL fixture of PROVIDER_DEFS and cannot
// catch drift in the real registry, so this test imports the real module.
//
// Live probes (llm-probeB.mjs / llm-probe4.mjs, app keys, 2026-10-12) proved
// the ids below are dead. Red-first: written BEFORE the repair (groq defaulted
// to llama-3.3-70b-versatile) — must fail then, and stay green after.

import { describe, expect, it, vi } from "vitest";

// _db-client must be mocked per test file (setup-env.ts blanks the Supabase
// URL so a real client fails fast) — same pattern as pii-masking.test.ts.
vi.mock("../../api/_db-client.js", () => ({ default: { from: vi.fn() } }));

// Real implementation (NOT the local fixture shadowing it in providers.test.ts).
import { PROVIDER_DEFS } from "../../api/_providers.js";

const KNOWN_DEAD = [
	"meta/llama-3.1-70b-instruct", // NVIDIA — HTTP 410 Gone (EOL 2026-08-26)
	"meta/llama-3.1-405b-instruct", // NVIDIA — HTTP 404
	"mistralai/mistral-large-2-instruct", // NVIDIA — HTTP 404
	"google/gemma-2-27b-it", // NVIDIA — HTTP 404
	"llama-3.3-70b-versatile", // Groq — HTTP 404 (does not exist)
	"llama-3.1-8b-instant", // Groq — HTTP 404 (does not exist)
	"mixtral-8x7b-32768", // Groq — HTTP 400 decommissioned
];

describe("PROVIDER_DEFS defaults — probed-dead model ids", () => {
	const entries = Object.entries(PROVIDER_DEFS).filter(
		([, def]) => def && typeof def.defaultModel === "string",
	);

	it("exposes a non-empty registry of defaults", () => {
		expect(entries.length).toBeGreaterThan(0);
	});

	it("never defaults any provider to a probed-dead model id", () => {
		const offenders = entries
			.filter(([, def]) => KNOWN_DEAD.includes(def.defaultModel))
			.map(([id, def]) => `${id} -> ${def.defaultModel}`);
		expect(offenders).toEqual([]);
	});
});
