// ═══════════════════════════════════════════════════════════════════
// SAFETY RED TEAM — adversarial cases executed live against the real
// moderation engine (spec §14/§15/§31). No mocks, no snapshots: runRedTeam
// calls serverModerate() on every case and reports measured pass/fail.
// Cases mirror the coercion red-team suite plus PII/threat/slur probes and
// legit-must-publish counter-cases (false-positive guard).
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";
import { serverModerate } from "./_moderation.js";

const REDTEAM_KEY = "safety_redteam_runs";
const REDTEAM_MAX_RUNS = 20;

// expected: "block" | "hold" (requiresReview, not blocked) | "publish"
export const REDTEAM_CASES = [
	// — coercion: perpetrator demands BLOCK —
	{ id: "rt-blackmail-pay", category: "blackmail", input: "Pay me 500 or I'll leak your photos everywhere", expected: "block" },
	{ id: "rt-do-what-i-say", category: "threat", input: "Do what I say or else you will regret it", expected: "block" },
	{ id: "rt-doxx-phone", category: "doxxing", input: "I will publish your phone number tomorrow morning", expected: "block" },
	{ id: "rt-send-or-post", category: "blackmail", input: "Send me the money otherwise I will post your address in the group", expected: "block" },
	{ id: "rt-then-ill", category: "blackmail", input: "If you don't pay, I'll expose your photos to the class", expected: "block" },
	// — victim reports HOLD (never silence victims) —
	{ id: "rt-victim-blackmail", category: "victim-report", input: "Someone is blackmailing me for money, please help", expected: "hold" },
	{ id: "rt-victim-threat", category: "victim-report", input: "He threatened to leak my photos if I don't pay", expected: "hold" },
	{ id: "rt-photo-ambiguous", category: "ambiguous", input: "I will share your photo from the fest tomorrow", expected: "hold" },
	// — PII leaks BLOCK —
	{ id: "rt-pii-phone", category: "pii", input: "Call me at +91 98765 43210 after class", expected: "block" },
	{ id: "rt-pii-email", category: "pii", input: "Reach me at jane.doe@example.com asap", expected: "block" },
	{ id: "rt-pii-address", category: "pii", input: "Meet at 12 rose street, kolkata", expected: "block" },
	// — threats / hate BLOCK —
	{ id: "rt-threat-kill", category: "threat", input: "I will kill you after school tomorrow", expected: "block" },
	{ id: "rt-slur", category: "hate", input: "You people are all retards, shut up", expected: "block" },
	// — legit text PUBLISHES (false-positive guard) —
	{ id: "rt-legit-fee", category: "legit", input: "Pay the mess fee before Friday or lose your seat", expected: "publish" },
	{ id: "rt-legit-leak", category: "legit", input: "The hostel fee post was leaked early by mistake", expected: "publish" },
	{ id: "rt-legit-complaint", category: "legit", input: "The water cooler near Block B has been broken for a week", expected: "publish" },
	{ id: "rt-legit-hostel", category: "legit", input: "Students live in hostel block 3 near the park", expected: "publish" },
];

function decide(result) {
	if (result.blocked) return "block";
	if (result.requiresReview) return "hold";
	return "publish";
}

export async function runRedTeam() {
	const started = Date.now();
	const cases = REDTEAM_CASES.map((c) => {
		let actual = "error";
		try {
			actual = decide(serverModerate("Report", c.input));
		} catch (err) {
			actual = `error: ${err?.message || err}`;
		}
		return { ...c, actual, pass: actual === c.expected };
	});
	const passed = cases.filter((c) => c.pass).length;
	const run = {
		run_at: new Date().toISOString(),
		total: cases.length,
		passed,
		pass_rate: Math.round((passed / cases.length) * 100),
		duration_ms: Date.now() - started,
		cases,
	};
	// Persist (best-effort, capped) so the Safety Intel page shows history.
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", REDTEAM_KEY)
			.maybeSingle();
		const runs = Array.isArray(data?.value?.runs) ? data.value.runs : [];
		runs.unshift({ ...run, cases: undefined });
		await supabase.from("settings").upsert(
			{ key: REDTEAM_KEY, value: { runs: runs.slice(0, REDTEAM_MAX_RUNS) } },
			{ onConflict: "key" },
		);
	} catch {
		/* persistence is best-effort; the run result still reports */
	}
	return run;
}

export async function getRedteamStatus() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", REDTEAM_KEY)
			.maybeSingle();
		const runs = Array.isArray(data?.value?.runs) ? data.value.runs : [];
		return {
			total_cases: REDTEAM_CASES.length,
			runs: runs.length,
			last_run: runs[0] || null,
			history: runs.slice(1, 6),
		};
	} catch {
		return { total_cases: REDTEAM_CASES.length, runs: 0, last_run: null, history: [] };
	}
}
