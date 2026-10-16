// NIM model-liveness contract.
//
// On 2026-09-26 a live probe of this deployment's NVIDIA key showed:
//   - nvidia/nemotron-3-nano-omni-30b-a3b-reasoning → 503 ResourceExhausted
//   - openai/gpt-oss-20b                        → hangs past 20s
//   - nvidia/nemotron-nano-3-30b-a3b            → 404 "Not found for account" (retired)
//   - nvidia/nemotron-3-ultra-550b-a55b         → 200 in ~4s (alive)
//   - nvidia/nemotron-3-super-120b-a12b         → 200 in ~2.5s (alive)
//   - openai/whisper-large-v3 (audio)           → 404 page not found (endpoint gone)
//
// A retired model ID in the hedge lane or serial chain is not a slow path —
// it is a guaranteed failure that burns the caller's whole timeout budget
// (the 15s tier-3 timeout fired on EVERY call while nano-3 sat in the chain).
// This test pins the source text so a dead ID can never be re-added
// without the suite going red. Liveness itself is probed live by
// D:\Temp\opencode\probe-models.cjs (not part of CI: it spends quota).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const providersSrc = readFileSync(
	resolve(process.cwd(), "api/_providers.js"),
	"utf8",
);

// Model IDs proven retired for this deployment (404/410 on the live probe).
// Re-adding any of these to an ACTIVE call path fails every request.
const RETIRED_MODEL_IDS = [
	"nvidia/nemotron-nano-3-30b-a3b",
	"meta/llama-3.1-8b-instruct",
	"meta/llama-3.3-70b-instruct",
];

function fastLane(src: string): string[] {
	const m = src.match(/NVIDIA_FAST_MODELS\s*=\s*\[([\s\S]*?)\];/);
	if (!m) return [];
	return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("NIM model-liveness contract", () => {
	it("keeps retired model IDs out of the provider source", () => {
		for (const id of RETIRED_MODEL_IDS) {
			// Exact-quoted match: comments may name a dead ID as a warning,
			// and other providers may embed it as a substring of their own
			// IDs (e.g. Cloudflare's @cf/...-fp16). Only a real reference
			// counts.
			expect(
				providersSrc,
				`retired model ${id} must not appear in api/_providers.js`,
			).not.toContain(`"${id}"`);
		}
	});

	it("hedges on at least two models so one congested tier cannot stall inbox", () => {
		expect(fastLane(providersSrc).length).toBeGreaterThanOrEqual(2);
	});

	it("hedges on the live-measured responders first", () => {
		const lane = fastLane(providersSrc);
		expect(lane[0]).toBe("nvidia/nemotron-3-super-120b-a12b");
		expect(lane).toContain("nvidia/nemotron-3-ultra-550b-a55b");
	});
});
